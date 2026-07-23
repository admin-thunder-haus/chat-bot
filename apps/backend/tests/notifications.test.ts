import request from 'supertest';
import { createApp } from '../src/app';
import { authHeader, setupTenant, type Tenant } from './helpers';
import { prisma } from './setup';
import { setAIProviderForTesting } from '../src/modules/ai';
import { makeFakeProvider } from './ai-helpers';
import { mailer } from '../src/utils/mailer';
import { emitDomainEvent } from '../src/modules/events/domain-events.service';

/**
 * In-app notifications: domain events create rows (mock-inbound flow),
 * handoff triggers role-targeted emails, and the read/unread API is
 * visibility-scoped and tenant-isolated.
 *
 * NOTE resetDatabase(): notifications cascade with their company (FK
 * onDelete: Cascade), so no explicit cleanup is needed.
 */

const app = createApp();
let acme: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
});

afterEach(() => {
  setAIProviderForTesting(null);
  jest.restoreAllMocks();
});

function mockInbound(
  token: string,
  extMsgId: string,
  content = 'Hi, what are your prices?',
  extCust = 'cust-1',
) {
  return request(app)
    .post('/api/v1/dev/mock-inbound-message')
    .set(authHeader(token))
    .send({
      channelType: 'MANUAL',
      externalCustomerId: extCust,
      customer: { fullName: 'Notify Customer' },
      message: { externalMessageId: extMsgId, content },
    });
}

function seedNotification(
  companyId: string,
  overrides: {
    userId?: string | null;
    title?: string;
    readAt?: Date | null;
    createdAt?: Date;
  } = {},
) {
  return prisma.notification.create({
    data: {
      companyId,
      userId: overrides.userId ?? null,
      type: 'SYSTEM_ALERT',
      title: overrides.title ?? 'Seeded',
      body: 'Seeded notification',
      readAt: overrides.readAt ?? null,
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    },
  });
}

describe('domain events -> notifications', () => {
  it('a new inbound conversation creates a NEW_CONVERSATION notification', async () => {
    const res = await mockInbound(acme.tokens.owner, 'n1');
    expect(res.status).toBe(201);

    const rows = await prisma.notification.findMany({
      where: { companyId: acme.company.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('NEW_CONVERSATION');
    expect(rows[0].userId).toBeNull();
    expect(rows[0].title).toContain('MANUAL');
    expect(rows[0].body).toContain('Notify Customer');
    expect(rows[0].readAt).toBeNull();

    // A follow-up message in the SAME conversation adds no notification.
    await mockInbound(acme.tokens.owner, 'n2', 'Another question');
    expect(
      await prisma.notification.count({
        where: { companyId: acme.company.id },
      }),
    ).toBe(1);
  });

  it('a handoff request notifies in-app and emails OWNER + ADMIN', async () => {
    const sendEmail = jest
      .spyOn(mailer, 'sendEmail')
      .mockResolvedValue(undefined);
    await prisma.companyAISettings.create({
      data: { companyId: acme.company.id, autoReplyEnabled: true },
    });
    setAIProviderForTesting(makeFakeProvider().provider);

    const res = await mockInbound(
      acme.tokens.owner,
      'h1',
      'I want to speak to a human please',
    );
    expect(res.body.data.autoReply.reason).toBe('handoff_requested');

    const handoff = await prisma.notification.findFirst({
      where: { companyId: acme.company.id, type: 'HANDOFF_REQUESTED' },
    });
    expect(handoff).not.toBeNull();

    const recipients = sendEmail.mock.calls
      .map(([input]) => input.to)
      .sort();
    expect(recipients).toEqual([
      acme.users.admin.email,
      acme.users.owner.email,
    ]);
  });

  it('emitDomainEvent never throws even when a consumer fails', async () => {
    jest
      .spyOn(mailer, 'sendEmail')
      .mockRejectedValue(new Error('smtp down'));
    await expect(
      emitDomainEvent({
        companyId: acme.company.id,
        type: 'handoff.requested',
        title: 'T',
        body: 'B',
        notify: { type: 'HANDOFF_REQUESTED', emailRoles: ['OWNER'] },
      }),
    ).resolves.toBeUndefined();
  });
});

describe('GET /api/v1/notifications', () => {
  it('lists visible rows newest first with pagination and unread filter', async () => {
    const old = new Date(Date.now() - 60_000);
    await seedNotification(acme.company.id, { title: 'older', createdAt: old });
    await seedNotification(acme.company.id, {
      title: 'read one',
      readAt: new Date(),
    });
    await seedNotification(acme.company.id, { title: 'newest' });

    const res = await request(app)
      .get('/api/v1/notifications')
      .set(authHeader(acme.tokens.agent)); // any role
    expect(res.status).toBe(200);
    expect(res.body.data.pagination.total).toBe(3);
    expect(res.body.data.items[0].title).toBe('newest');
    expect(res.body.data.items[res.body.data.items.length - 1].title).toBe(
      'older',
    );

    const unread = await request(app)
      .get('/api/v1/notifications?unread=true')
      .set(authHeader(acme.tokens.agent));
    expect(unread.body.data.pagination.total).toBe(2);
    const titles = unread.body.data.items.map((n: { title: string }) => n.title);
    expect(titles).not.toContain('read one');

    const page2 = await request(app)
      .get('/api/v1/notifications?page=2&limit=2')
      .set(authHeader(acme.tokens.agent));
    expect(page2.body.data.items).toHaveLength(1);
  });

  it('user-targeted rows are only visible to that user', async () => {
    await seedNotification(acme.company.id, {
      userId: acme.users.agent.id,
      title: 'for agent',
    });
    await seedNotification(acme.company.id, { title: 'for everyone' });

    const owner = await request(app)
      .get('/api/v1/notifications')
      .set(authHeader(acme.tokens.owner));
    expect(owner.body.data.pagination.total).toBe(1);
    expect(owner.body.data.items[0].title).toBe('for everyone');

    const agent = await request(app)
      .get('/api/v1/notifications')
      .set(authHeader(acme.tokens.agent));
    expect(agent.body.data.pagination.total).toBe(2);
  });

  it('is tenant-isolated', async () => {
    await seedNotification(acme.company.id);
    const globex = await setupTenant('globex');
    const res = await request(app)
      .get('/api/v1/notifications')
      .set(authHeader(globex.tokens.owner));
    expect(res.body.data.pagination.total).toBe(0);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/notifications');
    expect(res.status).toBe(401);
  });
});

describe('read state', () => {
  it('unread-count, mark one read, and read-all', async () => {
    await seedNotification(acme.company.id, { title: 'a' });
    const b = await seedNotification(acme.company.id, { title: 'b' });

    const before = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set(authHeader(acme.tokens.owner));
    expect(before.body.data.count).toBe(2);

    const mark = await request(app)
      .patch(`/api/v1/notifications/${b.id}/read`)
      .set(authHeader(acme.tokens.owner));
    expect(mark.status).toBe(200);
    expect(mark.body.data.notification.readAt).not.toBeNull();

    // Idempotent: marking again is still 200 and keeps readAt.
    const again = await request(app)
      .patch(`/api/v1/notifications/${b.id}/read`)
      .set(authHeader(acme.tokens.owner));
    expect(again.status).toBe(200);

    const mid = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set(authHeader(acme.tokens.owner));
    expect(mid.body.data.count).toBe(1);

    const all = await request(app)
      .post('/api/v1/notifications/read-all')
      .set(authHeader(acme.tokens.owner));
    expect(all.status).toBe(200);
    expect(all.body.data.updated).toBe(1);

    const after = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set(authHeader(acme.tokens.owner));
    expect(after.body.data.count).toBe(0);
  });

  it("cannot mark another tenant's notification read", async () => {
    const row = await seedNotification(acme.company.id);
    const globex = await setupTenant('globex');

    const res = await request(app)
      .patch(`/api/v1/notifications/${row.id}/read`)
      .set(authHeader(globex.tokens.owner));
    expect(res.status).toBe(404);

    const untouched = await prisma.notification.findUnique({
      where: { id: row.id },
    });
    expect(untouched!.readAt).toBeNull();
  });

  it("read-all does not touch another user's targeted rows", async () => {
    const targeted = await seedNotification(acme.company.id, {
      userId: acme.users.agent.id,
    });
    await seedNotification(acme.company.id);

    await request(app)
      .post('/api/v1/notifications/read-all')
      .set(authHeader(acme.tokens.owner));

    const row = await prisma.notification.findUnique({
      where: { id: targeted.id },
    });
    expect(row!.readAt).toBeNull();
  });
});
