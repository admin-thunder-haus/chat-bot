import { createHmac } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';
import { prisma } from './setup';
import { createFakeChannel, fakeInboundBody, postWebhook } from './channel-helpers';
import { channelDeliveryService } from '../src/modules/channels';

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
    fakeInboundBody({ messageId: `in-${accountId}`, customerId: `cust-${accountId}` }),
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

function deliveryFor(messageId: string) {
  return prisma.channelDelivery.findFirst({ where: { messageId } });
}

describe('Delivery engine — attempts, retry, recovery', () => {
  it('permanent failure fails immediately with one PERMANENT attempt', async () => {
    const { conversationId } = await fakeChannelConversation(acme);
    const res = await send(conversationId, acme.tokens.owner, 'nope __FAIL__');
    expect(res.body.data.message.status).toBe('FAILED');

    const d = await deliveryFor(res.body.data.message.id);
    expect(d?.status).toBe('FAILED');
    expect(d?.failureType).toBe('PERMANENT');
    expect(d?.attemptCount).toBe(1);
    const attempts = await prisma.channelDeliveryAttempt.findMany({
      where: { deliveryId: d!.id },
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe('PERMANENT_FAILURE');
  });

  it('temporary failure schedules a retry (QUEUED, nextAttemptAt, message PENDING)', async () => {
    const { conversationId } = await fakeChannelConversation(acme);
    const res = await send(conversationId, acme.tokens.owner, 'later __RETRY__');
    expect(res.body.data.message.status).toBe('PENDING');

    const d = await deliveryFor(res.body.data.message.id);
    expect(d?.status).toBe('QUEUED');
    expect(d?.failureType).toBe('TEMPORARY');
    expect(d?.attemptCount).toBe(1);
    expect(d?.nextAttemptAt).not.toBeNull();
    const act = await prisma.channelActivity.findFirst({
      where: { companyId: acme.company.id, activityType: 'DELIVERY_RETRY_SCHEDULED' },
    });
    expect(act).not.toBeNull();
  });

  it('recovers on a later attempt and marks DELIVERY_RECOVERED', async () => {
    const { conversationId } = await fakeChannelConversation(acme);
    const res = await send(conversationId, acme.tokens.owner, 'ok soon __RETRY_OK__');
    const d = await deliveryFor(res.body.data.message.id);
    expect(d?.status).toBe('QUEUED'); // first attempt failed transiently

    // Second attempt (would be driven by a worker in Part 3) succeeds.
    const result = await channelDeliveryService.attemptDelivery(
      acme.company.id,
      d!.id,
    );
    expect(result.status).toBe('sent');
    const after = await deliveryFor(res.body.data.message.id);
    expect(after?.status).toBe('SENT');
    expect(after?.externalMessageId).toMatch(/^fake-out-/);
    expect(after?.attemptCount).toBe(2);
    const msg = await prisma.message.findFirst({ where: { id: res.body.data.message.id } });
    expect(msg?.status).toBe('SENT');
    const recovered = await prisma.channelActivity.findFirst({
      where: { companyId: acme.company.id, activityType: 'DELIVERY_RECOVERED' },
    });
    expect(recovered).not.toBeNull();
  });

  it('exhausts retries and fails permanently after maxAttempts', async () => {
    const { conversationId } = await fakeChannelConversation(acme);
    const res = await send(conversationId, acme.tokens.owner, 'always __RETRY__');
    const d = await deliveryFor(res.body.data.message.id);
    // Attempt 1 already scheduled a retry. Drive attempts 2 and 3.
    await channelDeliveryService.attemptDelivery(acme.company.id, d!.id);
    const r3 = await channelDeliveryService.attemptDelivery(acme.company.id, d!.id);
    expect(r3.status).toBe('failed');
    const after = await deliveryFor(res.body.data.message.id);
    expect(after?.status).toBe('FAILED');
    expect(after?.attemptCount).toBe(3); // default maxAttempts
    const msg = await prisma.message.findFirst({ where: { id: res.body.data.message.id } });
    expect(msg?.status).toBe('FAILED');
  });

  it('runDueRetries only processes deliveries whose retry time has elapsed', async () => {
    const { conversationId } = await fakeChannelConversation(acme);
    const res = await send(conversationId, acme.tokens.owner, 'due __RETRY_OK__');
    const d = await deliveryFor(res.body.data.message.id);

    // Not yet due (nextAttemptAt is in the future) -> nothing processed.
    const none = await channelDeliveryService.runDueRetries(acme.company.id);
    expect(none.processed).toBe(0);

    // Make it due, then process.
    await prisma.channelDelivery.update({
      where: { id: d!.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    const run = await channelDeliveryService.runDueRetries(acme.company.id);
    expect(run.processed).toBe(1);
    const after = await deliveryFor(res.body.data.message.id);
    expect(after?.status).toBe('SENT');
  });

  it('recovers deliveries stuck in SENDING (crash recovery)', async () => {
    const { conversationId } = await fakeChannelConversation(acme);
    const res = await send(conversationId, acme.tokens.owner, 'stuck __RETRY_OK__');
    const d = await deliveryFor(res.body.data.message.id);
    // Simulate a crash mid-attempt: force SENDING with an old lastAttemptAt.
    await prisma.channelDelivery.update({
      where: { id: d!.id },
      data: { status: 'SENDING', lastAttemptAt: new Date(Date.now() - 120000) },
    });
    const rec = await channelDeliveryService.recoverStuckDeliveries(60000, acme.company.id);
    expect(rec.recovered).toBe(1);
    const after = await deliveryFor(res.body.data.message.id);
    expect(after?.status).toBe('QUEUED');
  });

  it('manual retry endpoint re-attempts (OWNER/ADMIN only, tenant-isolated)', async () => {
    const { accountId, conversationId } = await fakeChannelConversation(acme);
    const res = await send(conversationId, acme.tokens.owner, 'manual __RETRY_OK__');
    const d = await deliveryFor(res.body.data.message.id);

    // AGENT cannot trigger a retry.
    const agent = await request(app)
      .post(`/api/v1/channels/${accountId}/deliveries/${d!.id}/retry`)
      .set(authHeader(acme.tokens.agent));
    expect(agent.status).toBe(403);

    // Cross-tenant is blocked (account not found for the other tenant).
    const cross = await request(app)
      .post(`/api/v1/channels/${accountId}/deliveries/${d!.id}/retry`)
      .set(authHeader(globex.tokens.owner));
    expect(cross.status).toBe(404);

    // OWNER retry succeeds (attempt 2 of __RETRY_OK__).
    const owner = await request(app)
      .post(`/api/v1/channels/${accountId}/deliveries/${d!.id}/retry`)
      .set(authHeader(acme.tokens.owner));
    expect(owner.status).toBe(200);
    expect(owner.body.data.result.status).toBe('sent');
  });
});

describe('Delivery status callbacks — idempotent + monotonic', () => {
  async function sentDelivery(tenant: Tenant) {
    const { accountId, conversationId } = await fakeChannelConversation(tenant);
    const res = await send(conversationId, tenant.tokens.owner, 'ship it');
    const d = await deliveryFor(res.body.data.message.id);
    return { accountId, delivery: d! };
  }

  function statusWebhook(
    accountId: string,
    externalMessageId: string,
    status: string,
    eventId: string,
  ) {
    const body = { event: 'delivery', eventId, messageId: externalMessageId, status };
    const raw = JSON.stringify(body);
    const sig = createHmac('sha256', 'test-fake-webhook-secret')
      .update(raw)
      .digest('hex');
    return request(app)
      .post(`/api/v1/webhooks/fake/${accountId}`)
      .set('Content-Type', 'application/json')
      .set('x-fake-signature', sig)
      .send(raw);
  }

  it('advances SENT -> DELIVERED -> READ and ignores duplicates / out-of-order', async () => {
    const { accountId, delivery } = await sentDelivery(acme);
    const ext = delivery.externalMessageId!;

    await statusWebhook(accountId, ext, 'delivered', 'e1');
    let d = await prisma.channelDelivery.findFirst({ where: { id: delivery.id } });
    expect(d?.status).toBe('DELIVERED');

    // Duplicate delivered -> not applied.
    const dup = await statusWebhook(accountId, ext, 'delivered', 'e2');
    expect(dup.body.data.duplicates).toBe(1);

    // Out-of-order 'sent' after 'delivered' -> ignored (monotonic).
    await statusWebhook(accountId, ext, 'sent', 'e3');
    d = await prisma.channelDelivery.findFirst({ where: { id: delivery.id } });
    expect(d?.status).toBe('DELIVERED');

    // Advance to READ.
    await statusWebhook(accountId, ext, 'read', 'e4');
    d = await prisma.channelDelivery.findFirst({ where: { id: delivery.id } });
    expect(d?.status).toBe('READ');
  });
});
