import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';
import { prisma } from './setup';
import { createFakeChannel, fakeInboundBody, postWebhook } from './channel-helpers';

const app = createApp();
let acme: Tenant;
let globex: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
});

async function fakeChannelConversation(tenant: Tenant) {
  const created = await createFakeChannel(app, tenant.tokens.owner);
  const accountId = created.body.data.account.id;
  await postWebhook(
    app,
    accountId,
    fakeInboundBody({ messageId: `in-${accountId}`, customerId: `c-${accountId}` }),
  );
  const conv = await prisma.conversation.findFirst({
    where: { companyId: tenant.company.id, channelAccountId: accountId },
  });
  return { accountId, conversationId: conv!.id };
}

function send(convId: string, token: string, content: string) {
  return request(app)
    .post(`/api/v1/conversations/${convId}/messages`)
    .set(authHeader(token))
    .send({ content });
}

function diagnostics(accountId: string, token: string) {
  return request(app)
    .get(`/api/v1/channels/${accountId}/diagnostics`)
    .set(authHeader(token));
}

describe('Channel health monitoring', () => {
  it('a successful delivery bumps success counters + records history', async () => {
    const { accountId, conversationId } = await fakeChannelConversation(acme);
    await send(conversationId, acme.tokens.owner, 'hello');

    const account = await prisma.channelAccount.findFirst({ where: { id: accountId } });
    expect(account?.successCount).toBe(1);
    expect(account?.consecutiveFailures).toBe(0);
    expect(account?.lastSuccessfulDeliveryAt).not.toBeNull();

    const samples = await prisma.channelHealthCheck.findMany({
      where: { channelAccountId: accountId, checkType: 'DELIVERY' },
    });
    expect(samples.length).toBeGreaterThanOrEqual(1);
  });

  it('failures lower the health score, degrade the state, and log CHANNEL_DEGRADED', async () => {
    const { accountId, conversationId } = await fakeChannelConversation(acme);
    // Three permanent failures: score 100 -> 70 -> 40 -> 10 (HEALTHY -> DEGRADED -> UNAVAILABLE).
    await send(conversationId, acme.tokens.owner, 'x __FAIL__');
    await send(conversationId, acme.tokens.owner, 'y __FAIL__');
    await send(conversationId, acme.tokens.owner, 'z __FAIL__');

    const account = await prisma.channelAccount.findFirst({ where: { id: accountId } });
    expect(account?.failureCount).toBe(3);
    expect(account?.consecutiveFailures).toBe(3);
    expect(account?.healthScore).toBeLessThan(70);
    expect(['DEGRADED', 'UNAVAILABLE']).toContain(account?.connectionState);
    expect(account?.lastFailedDeliveryAt).not.toBeNull();

    const degraded = await prisma.channelActivity.findFirst({
      where: { companyId: acme.company.id, activityType: 'CHANNEL_DEGRADED' },
    });
    expect(degraded).not.toBeNull();
  });

  it('exposes a safe diagnostics bundle (no credentials) to all roles', async () => {
    const { accountId, conversationId } = await fakeChannelConversation(acme);
    await send(conversationId, acme.tokens.owner, 'ok');
    await send(conversationId, acme.tokens.owner, 'bad __FAIL__');

    const res = await diagnostics(accountId, acme.tokens.agent); // AGENT may read
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.health).toBeDefined();
    expect(d.health.healthScore).toEqual(expect.any(Number));
    expect(d.healthHistory.length).toBeGreaterThan(0);
    expect(d.deliveryMetrics.byStatus).toBeDefined();
    expect(d.retryStats).toBeDefined();
    expect(Array.isArray(d.recentFailures)).toBe(true);
    expect(Array.isArray(d.recentRecoveries)).toBe(true);
    // Never leak credentials.
    expect(JSON.stringify(res.body)).not.toContain('encryptedPayload');
    expect(JSON.stringify(res.body)).not.toContain('webhookSecret');
  });

  it('diagnostics is tenant-isolated (cross-tenant returns 404)', async () => {
    const { accountId } = await fakeChannelConversation(acme);
    const res = await diagnostics(accountId, globex.tokens.owner);
    expect(res.status).toBe(404);
  });

  it('manual health check records a MANUAL history sample and updates state', async () => {
    const created = await createFakeChannel(app, acme.tokens.owner, {
      metadata: { healthSimulation: 'degraded' },
    });
    const accountId = created.body.data.account.id;
    const res = await request(app)
      .post(`/api/v1/channels/${accountId}/health-check`)
      .set(authHeader(acme.tokens.owner));
    expect(res.body.data.account.connectionState).toBe('DEGRADED');

    const manual = await prisma.channelHealthCheck.findFirst({
      where: { channelAccountId: accountId, checkType: 'MANUAL' },
    });
    expect(manual).not.toBeNull();
    expect(manual?.state).toBe('DEGRADED');
  });
});
