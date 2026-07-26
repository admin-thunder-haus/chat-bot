import request from 'supertest';
import type { LoginAuditOutcome } from '@prisma/client';
import { createApp } from '../src/app';
import { prisma } from './setup';
import { authHeader, setupTenant, type Tenant } from './helpers';
import { hashPassword } from '../src/utils/password';
import { pruneLoginAuditEvents } from '../src/modules/auth/login-audit.service';
import { env } from '../src/config/env';

/**
 * The login audit trail. What is worth pinning here is not "a row appears" but
 * that every distinguishable login branch keeps its OWN outcome (collapsing two
 * of them would silently destroy the signal), that a user can only ever read
 * their own trail, and that the trail is actually bounded in time.
 */

const app = createApp();

const PASSWORD = 'StrongPassword123!';
const USER_AGENT = 'AuditTest/1.0 (jest)';
const CLIENT_IP = '203.0.113.9';

/**
 * Fixture users carry a placeholder hash (helpers.ts mints tokens instead of
 * logging in), so a real password has to be installed before a login can
 * succeed. Everything else about the fixture is reused as-is.
 */
async function withPassword(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(PASSWORD) },
  });
}

/**
 * Log in through the real HTTP surface. X-Forwarded-For is honoured because
 * app.ts sets 'trust proxy', which is exactly the production path (Render's
 * proxy) the recorded IP has to come from.
 */
function login(email: string, password: string = PASSWORD) {
  return request(app)
    .post('/api/v1/auth/login')
    .set('User-Agent', USER_AGENT)
    .set('X-Forwarded-For', CLIENT_IP)
    .send({ email, password });
}

function auditRows(email: string) {
  return prisma.loginAuditEvent.findMany({
    where: { email },
    orderBy: { createdAt: 'asc' },
  });
}

async function onlyAuditRow(email: string) {
  const rows = await auditRows(email);
  expect(rows).toHaveLength(1);
  return rows[0];
}

describe('login audit recording', () => {
  let tenant: Tenant;

  beforeEach(async () => {
    tenant = await setupTenant('audit-a');
    await withPassword(tenant.users.owner.id);
  });

  it('records SUCCESS with the client ip and user agent', async () => {
    const res = await login(tenant.users.owner.email);
    expect(res.status).toBe(200);

    const row = await onlyAuditRow(tenant.users.owner.email);
    expect(row.outcome).toBe<LoginAuditOutcome>('SUCCESS');
    expect(row.userId).toBe(tenant.users.owner.id);
    expect(row.companyId).toBe(tenant.company.id);
    expect(row.ipAddress).toBe(CLIENT_IP);
    expect(row.userAgent).toBe(USER_AGENT);
  });

  it('records INVALID_PASSWORD for a wrong password', async () => {
    const res = await login(tenant.users.owner.email, 'WrongPassword123!');
    expect(res.status).toBe(401);
    // The response must stay generic — the audit row is the only place the
    // real reason is written down.
    expect(res.body.message).toBe('Invalid email or password');

    const row = await onlyAuditRow(tenant.users.owner.email);
    expect(row.outcome).toBe<LoginAuditOutcome>('INVALID_PASSWORD');
    expect(row.userId).toBe(tenant.users.owner.id);
  });

  it('records UNKNOWN_EMAIL with a null userId and null companyId', async () => {
    const res = await login('nobody@example.com');
    expect(res.status).toBe(401);

    const row = await onlyAuditRow('nobody@example.com');
    expect(row.outcome).toBe<LoginAuditOutcome>('UNKNOWN_EMAIL');
    expect(row.userId).toBeNull();
    expect(row.companyId).toBeNull();
    // The attempted address is the only identifier such an attempt has.
    expect(row.email).toBe('nobody@example.com');
  });

  it('lowercases the attempted email so a case-variant probe cannot hide', async () => {
    await login('NoBody@Example.COM');
    const row = await onlyAuditRow('nobody@example.com');
    expect(row.outcome).toBe<LoginAuditOutcome>('UNKNOWN_EMAIL');
  });

  it('records ACCOUNT_DISABLED for a disabled account', async () => {
    await prisma.user.update({
      where: { id: tenant.users.owner.id },
      data: { status: 'DISABLED' },
    });

    const res = await login(tenant.users.owner.email);
    expect(res.status).toBe(403);

    const row = await onlyAuditRow(tenant.users.owner.email);
    expect(row.outcome).toBe<LoginAuditOutcome>('ACCOUNT_DISABLED');
    expect(row.userId).toBe(tenant.users.owner.id);
  });

  it('records EMAIL_NOT_VERIFIED for an unverified account', async () => {
    await prisma.user.update({
      where: { id: tenant.users.owner.id },
      data: { emailVerifiedAt: null },
    });

    const res = await login(tenant.users.owner.email);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');

    const row = await onlyAuditRow(tenant.users.owner.email);
    expect(row.outcome).toBe<LoginAuditOutcome>('EMAIL_NOT_VERIFIED');
  });

  it('records COMPANY_SUSPENDED when the tenant is suspended', async () => {
    await prisma.company.update({
      where: { id: tenant.company.id },
      data: { status: 'SUSPENDED' },
    });

    const res = await login(tenant.users.owner.email);
    expect(res.status).toBe(403);

    const row = await onlyAuditRow(tenant.users.owner.email);
    expect(row.outcome).toBe<LoginAuditOutcome>('COMPANY_SUSPENDED');
    expect(row.companyId).toBe(tenant.company.id);
  });

  it('truncates an oversized user agent instead of storing it whole', async () => {
    const huge = 'U'.repeat(2000);
    await request(app)
      .post('/api/v1/auth/login')
      .set('User-Agent', huge)
      .send({ email: tenant.users.owner.email, password: PASSWORD });

    const row = await onlyAuditRow(tenant.users.owner.email);
    expect(row.userAgent).toHaveLength(512);
  });

  it('never fails a login when the audit write fails', async () => {
    const spy = jest
      .spyOn(prisma.loginAuditEvent, 'create')
      .mockRejectedValue(new Error('audit table is on fire'));

    const res = await login(tenant.users.owner.email);
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));

    spy.mockRestore();
  });
});

describe('GET /api/v1/auth/login-history', () => {
  it('returns only the calling user’s own rows', async () => {
    const tenant = await setupTenant('audit-own');
    await withPassword(tenant.users.owner.id);
    await withPassword(tenant.users.agent.id);

    await login(tenant.users.owner.email);
    await login(tenant.users.agent.email);
    await login(tenant.users.agent.email, 'WrongPassword123!');

    const res = await request(app)
      .get('/api/v1/auth/login-history')
      .set(authHeader(tenant.tokens.owner));

    expect(res.status).toBe(200);
    expect(res.body.data.events).toHaveLength(1);
    expect(res.body.data.events[0].outcome).toBe('SUCCESS');
    expect(res.body.data.limit).toBe(20);
    // The colleague's two attempts are in the same company and still invisible.
    const agentRes = await request(app)
      .get('/api/v1/auth/login-history')
      .set(authHeader(tenant.tokens.agent));
    expect(agentRes.body.data.events).toHaveLength(2);
  });

  it('never returns rows from another tenant', async () => {
    const first = await setupTenant('audit-t1');
    const second = await setupTenant('audit-t2');
    await withPassword(first.users.owner.id);
    await withPassword(second.users.owner.id);

    await login(first.users.owner.email);
    await login(second.users.owner.email);

    const res = await request(app)
      .get('/api/v1/auth/login-history')
      .set(authHeader(second.tokens.owner));

    expect(res.status).toBe(200);
    expect(res.body.data.events).toHaveLength(1);

    // Prove it by identity, not by count: the visible row must be the one the
    // second tenant's own login wrote.
    const own = await prisma.loginAuditEvent.findFirst({
      where: { userId: second.users.owner.id },
    });
    expect(res.body.data.events[0].id).toBe(own?.id);
  });

  it('exposes no field that could identify another account', async () => {
    const tenant = await setupTenant('audit-shape');
    await withPassword(tenant.users.owner.id);
    await login(tenant.users.owner.email);

    const res = await request(app)
      .get('/api/v1/auth/login-history')
      .set(authHeader(tenant.tokens.owner));

    expect(Object.keys(res.body.data.events[0]).sort()).toEqual([
      'createdAt',
      'id',
      'ipAddress',
      'outcome',
      'userAgent',
    ]);
  });

  it('returns newest first and caps the list at 20 rows', async () => {
    const tenant = await setupTenant('audit-cap');
    const base = Date.now();

    await prisma.loginAuditEvent.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        companyId: tenant.company.id,
        userId: tenant.users.owner.id,
        email: tenant.users.owner.email,
        outcome: 'SUCCESS' as LoginAuditOutcome,
        createdAt: new Date(base - i * 60_000),
      })),
    });

    const res = await request(app)
      .get('/api/v1/auth/login-history')
      .set(authHeader(tenant.tokens.owner));

    expect(res.body.data.events).toHaveLength(20);
    const times = (res.body.data.events as { createdAt: string }[]).map((e) =>
      new Date(e.createdAt).getTime(),
    );
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/auth/login-history');
    expect(res.status).toBe(401);
  });
});

describe('pruneLoginAuditEvents', () => {
  it('deletes rows past the retention window and keeps newer ones', async () => {
    const tenant = await setupTenant('audit-prune');
    const day = 86_400_000;
    const retention = env.LOGIN_AUDIT_RETENTION_DAYS;

    const row = (email: string, ageDays: number) => ({
      companyId: tenant.company.id,
      userId: tenant.users.owner.id,
      email,
      outcome: 'SUCCESS' as LoginAuditOutcome,
      createdAt: new Date(Date.now() - ageDays * day),
    });

    await prisma.loginAuditEvent.createMany({
      data: [
        row('fresh@example.com', 0),
        row('inside@example.com', retention - 1),
        row('expired@example.com', retention + 1),
        row('ancient@example.com', retention * 3),
      ],
    });

    const result = await pruneLoginAuditEvents();

    expect(result.deleted).toBe(2);
    expect(result.error).toBeUndefined();
    const remaining = await prisma.loginAuditEvent.findMany({
      select: { email: true },
      orderBy: { email: 'asc' },
    });
    expect(remaining.map((r) => r.email)).toEqual([
      'fresh@example.com',
      'inside@example.com',
    ]);
  });

  it('also prunes rows no cascade would ever reach (unknown-email attempts)', async () => {
    await prisma.loginAuditEvent.create({
      data: {
        email: 'orphan@example.com',
        outcome: 'UNKNOWN_EMAIL',
        createdAt: new Date(
          Date.now() - (env.LOGIN_AUDIT_RETENTION_DAYS + 5) * 86_400_000,
        ),
      },
    });

    const result = await pruneLoginAuditEvents();
    expect(result.deleted).toBe(1);
    expect(await prisma.loginAuditEvent.count()).toBe(0);
  });

  it('swallows a database failure instead of throwing at its caller', async () => {
    const spy = jest
      .spyOn(prisma.loginAuditEvent, 'deleteMany')
      .mockRejectedValue(new Error('prune exploded'));

    const result = await pruneLoginAuditEvents();
    expect(result).toEqual({ deleted: 0, error: 'prune exploded' });

    spy.mockRestore();
  });
});
