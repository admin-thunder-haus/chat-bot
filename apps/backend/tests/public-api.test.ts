import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import {
  authHeader,
  makeConversation,
  makeCustomer,
  setupTenant,
  type Tenant,
} from './helpers';
import { prisma } from './setup';
import {
  setOutboundWebhookTransportForTesting,
  type OutboundWebhookRequest,
} from '../src/modules/public-api/outbound-webhooks.service';

/**
 * Public API keys, the API-key-authenticated read surface, and signed
 * outbound webhooks (CRUD + dispatcher: signatures, retries, delivery log).
 *
 * NOTE resetDatabase(): api keys, webhooks and deliveries all cascade with
 * their company (FK onDelete: Cascade), so no explicit cleanup is needed.
 */

const app = createApp();
let acme: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
});

afterEach(() => {
  setOutboundWebhookTransportForTesting(null);
});

function createApiKey(token: string, name = 'CI key') {
  return request(app)
    .post('/api/v1/integrations/api-keys')
    .set(authHeader(token))
    .send({ name });
}

function createWebhook(token: string, events: string[], url = 'https://example.com/hooks') {
  return request(app)
    .post('/api/v1/integrations/webhooks')
    .set(authHeader(token))
    .send({ url, events });
}

function mockInbound(token: string, extMsgId: string, extCust = 'cust-1') {
  return request(app)
    .post('/api/v1/dev/mock-inbound-message')
    .set(authHeader(token))
    .send({
      channelType: 'MANUAL',
      externalCustomerId: extCust,
      customer: { fullName: 'Hook Customer' },
      message: { externalMessageId: extMsgId, content: 'Hello there' },
    });
}

describe('API key management (/api/v1/integrations/api-keys)', () => {
  it('OWNER creates a key; the full key is returned exactly once', async () => {
    const res = await createApiKey(acme.tokens.owner);
    expect(res.status).toBe(201);

    const { key, apiKey } = res.body.data;
    expect(key).toMatch(/^ak_live_[0-9a-f]{32}$/);
    expect(apiKey.keyPrefix).toBe(key.slice(0, 12));
    expect(apiKey.scopes).toEqual(['read']);
    expect(apiKey.revokedAt).toBeNull();

    // Only the hash is stored — never the key itself.
    const stored = await prisma.apiKey.findUnique({ where: { id: apiKey.id } });
    expect(stored!.keyHash).toBe(
      crypto.createHash('sha256').update(key).digest('hex'),
    );

    // The list never exposes the key (or hash).
    const list = await request(app)
      .get('/api/v1/integrations/api-keys')
      .set(authHeader(acme.tokens.admin));
    expect(list.status).toBe(200);
    expect(list.body.data.apiKeys).toHaveLength(1);
    expect(list.body.data.apiKeys[0].key).toBeUndefined();
    expect(list.body.data.apiKeys[0].keyHash).toBeUndefined();
    expect(list.body.data.apiKeys[0].keyPrefix).toBe(key.slice(0, 12));
  });

  it('AGENT cannot manage keys', async () => {
    const create = await createApiKey(acme.tokens.agent);
    expect(create.status).toBe(403);
    const list = await request(app)
      .get('/api/v1/integrations/api-keys')
      .set(authHeader(acme.tokens.agent));
    expect(list.status).toBe(403);
  });

  it('DELETE revokes a key (and revoked keys stop authenticating)', async () => {
    const created = await createApiKey(acme.tokens.owner);
    const { key, apiKey } = created.body.data;

    const ok = await request(app)
      .get('/api/public/v1/me')
      .set({ Authorization: `Bearer ${key}` });
    expect(ok.status).toBe(200);

    const revoke = await request(app)
      .delete(`/api/v1/integrations/api-keys/${apiKey.id}`)
      .set(authHeader(acme.tokens.owner));
    expect(revoke.status).toBe(200);
    expect(revoke.body.data.apiKey.revokedAt).not.toBeNull();

    const rejected = await request(app)
      .get('/api/public/v1/me')
      .set({ Authorization: `Bearer ${key}` });
    expect(rejected.status).toBe(401);
  });

  it("cannot revoke another tenant's key", async () => {
    const created = await createApiKey(acme.tokens.owner);
    const globex = await setupTenant('globex');
    const res = await request(app)
      .delete(`/api/v1/integrations/api-keys/${created.body.data.apiKey.id}`)
      .set(authHeader(globex.tokens.owner));
    expect(res.status).toBe(404);
  });
});

describe('public API surface (/api/public/v1)', () => {
  it('rejects missing and malformed keys', async () => {
    expect(
      (await request(app).get('/api/public/v1/me')).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .get('/api/public/v1/me')
          .set({ Authorization: 'Bearer ak_live_00000000000000000000000000000000' })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .get('/api/public/v1/me')
          .set({ Authorization: 'Bearer not-an-api-key' })
      ).status,
    ).toBe(401);
  });

  it('GET /me returns company + key info and stamps lastUsedAt', async () => {
    const created = await createApiKey(acme.tokens.owner, 'Integration');
    const { key, apiKey } = created.body.data;

    const res = await request(app)
      .get('/api/public/v1/me')
      .set({ Authorization: `Bearer ${key}` });
    expect(res.status).toBe(200);
    expect(res.body.data.company.name).toBe(acme.company.name);
    expect(res.body.data.apiKey.name).toBe('Integration');
    expect(res.body.data.apiKey.scopes).toEqual(['read']);

    const stored = await prisma.apiKey.findUnique({ where: { id: apiKey.id } });
    expect(stored!.lastUsedAt).not.toBeNull();
  });

  it('reads are strictly scoped to the key tenant', async () => {
    const customer = await makeCustomer(acme.company.id, {
      fullName: 'Acme Customer',
    });
    const conv = await makeConversation(acme.company.id, customer.id);
    await prisma.message.create({
      data: {
        companyId: acme.company.id,
        conversationId: conv.id,
        customerId: customer.id,
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        content: 'Public API hello',
        status: 'RECEIVED',
        sentAt: new Date(),
      },
    });

    const globex = await setupTenant('globex');
    const acmeKey = (await createApiKey(acme.tokens.owner)).body.data.key;
    const globexKey = (await createApiKey(globex.tokens.owner)).body.data.key;

    const mine = await request(app)
      .get('/api/public/v1/conversations')
      .set({ Authorization: `Bearer ${acmeKey}` });
    expect(mine.status).toBe(200);
    expect(mine.body.data.pagination.total).toBe(1);
    expect(mine.body.data.items[0].customer.fullName).toBe('Acme Customer');
    // Internal fields are not exposed.
    expect(mine.body.data.items[0].unreadCount).toBeUndefined();
    expect(mine.body.data.items[0].aiMode).toBeUndefined();

    const theirs = await request(app)
      .get('/api/public/v1/conversations')
      .set({ Authorization: `Bearer ${globexKey}` });
    expect(theirs.body.data.pagination.total).toBe(0);

    const detail = await request(app)
      .get(`/api/public/v1/conversations/${conv.id}`)
      .set({ Authorization: `Bearer ${acmeKey}` });
    expect(detail.status).toBe(200);
    expect(detail.body.data.messages).toHaveLength(1);
    expect(detail.body.data.messages[0].content).toBe('Public API hello');

    const foreign = await request(app)
      .get(`/api/public/v1/conversations/${conv.id}`)
      .set({ Authorization: `Bearer ${globexKey}` });
    expect(foreign.status).toBe(404);

    const customers = await request(app)
      .get('/api/public/v1/customers')
      .set({ Authorization: `Bearer ${acmeKey}` });
    expect(customers.status).toBe(200);
    expect(customers.body.data.pagination.total).toBe(1);
    expect(customers.body.data.items[0].fullName).toBe('Acme Customer');
  });
});

describe('outbound webhook management (/api/v1/integrations/webhooks)', () => {
  it('creates a webhook, returning the signing secret exactly once', async () => {
    const res = await createWebhook(acme.tokens.owner, [
      'conversation.created',
    ]);
    expect(res.status).toBe(201);
    expect(res.body.data.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(res.body.data.webhook.isActive).toBe(true);
    expect(res.body.data.webhook.events).toEqual(['conversation.created']);
    // The stored secret is encrypted, never plaintext.
    const stored = await prisma.outboundWebhook.findUnique({
      where: { id: res.body.data.webhook.id },
    });
    expect(stored!.encryptedSecret).not.toContain(res.body.data.secret);

    const list = await request(app)
      .get('/api/v1/integrations/webhooks')
      .set(authHeader(acme.tokens.owner));
    expect(list.body.data.webhooks).toHaveLength(1);
    expect(list.body.data.webhooks[0].secret).toBeUndefined();
    expect(list.body.data.webhooks[0].encryptedSecret).toBeUndefined();
    expect(list.body.data.webhooks[0].deliveryCount).toBe(0);
  });

  it('validates url and event names; AGENT is forbidden', async () => {
    expect(
      (await createWebhook(acme.tokens.owner, ['conversation.created'], 'ftp://nope')).status,
    ).toBe(400);
    expect(
      (await createWebhook(acme.tokens.owner, ['not.an.event'])).status,
    ).toBe(400);
    expect((await createWebhook(acme.tokens.owner, [])).status).toBe(400);
    expect(
      (await createWebhook(acme.tokens.agent, ['conversation.created'])).status,
    ).toBe(403);
  });

  it('PATCH updates url/events/isActive and DELETE removes (tenant-scoped)', async () => {
    const created = await createWebhook(acme.tokens.owner, [
      'conversation.created',
    ]);
    const id = created.body.data.webhook.id;

    const patch = await request(app)
      .patch(`/api/v1/integrations/webhooks/${id}`)
      .set(authHeader(acme.tokens.admin))
      .send({ isActive: false, events: ['conversation.resolved'] });
    expect(patch.status).toBe(200);
    expect(patch.body.data.webhook.isActive).toBe(false);
    expect(patch.body.data.webhook.events).toEqual(['conversation.resolved']);

    const globex = await setupTenant('globex');
    const foreign = await request(app)
      .patch(`/api/v1/integrations/webhooks/${id}`)
      .set(authHeader(globex.tokens.owner))
      .send({ isActive: true });
    expect(foreign.status).toBe(404);

    const del = await request(app)
      .delete(`/api/v1/integrations/webhooks/${id}`)
      .set(authHeader(acme.tokens.owner));
    expect(del.status).toBe(200);
    expect(
      await prisma.outboundWebhook.count({ where: { id } }),
    ).toBe(0);
  });
});

describe('webhook dispatch', () => {
  it('delivers signed payloads for subscribed events (mock-inbound flow)', async () => {
    const created = await createWebhook(acme.tokens.owner, [
      'conversation.created',
      'customer.created',
    ]);
    const { secret } = created.body.data;
    const webhookId = created.body.data.webhook.id;

    const calls: { url: string; request: OutboundWebhookRequest }[] = [];
    setOutboundWebhookTransportForTesting(async (url, req) => {
      calls.push({ url, request: req });
      return { status: 200 };
    });

    const res = await mockInbound(acme.tokens.owner, 'wh1');
    expect(res.status).toBe(201);

    // conversation.created + customer.created — both subscribed.
    expect(calls).toHaveLength(2);
    const eventTypes = calls
      .map((c) => c.request.headers['X-Webhook-Event'])
      .sort();
    expect(eventTypes).toEqual(['conversation.created', 'customer.created']);

    for (const call of calls) {
      expect(call.url).toBe('https://example.com/hooks');
      // The signature verifies against the ONE-TIME secret + raw body.
      const expected = `sha256=${crypto
        .createHmac('sha256', secret)
        .update(call.request.body)
        .digest('hex')}`;
      expect(call.request.headers['X-Webhook-Signature']).toBe(expected);

      const payload = JSON.parse(call.request.body);
      expect(payload.id).toBeTruthy();
      expect(payload.createdAt).toBeTruthy();
      expect(payload.data.title).toBeTruthy();
    }

    // Delivery log + health counters.
    const deliveries = await prisma.outboundWebhookDelivery.findMany({
      where: { webhookId },
    });
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((d) => d.status === 'delivered')).toBe(true);
    expect(deliveries.every((d) => d.attemptCount === 1)).toBe(true);

    const webhook = await prisma.outboundWebhook.findUnique({
      where: { id: webhookId },
    });
    expect(webhook!.failureCount).toBe(0);
    expect(webhook!.lastSuccessAt).not.toBeNull();

    // GET deliveries endpoint returns the log rows.
    const log = await request(app)
      .get(`/api/v1/integrations/webhooks/${webhookId}/deliveries`)
      .set(authHeader(acme.tokens.owner));
    expect(log.status).toBe(200);
    expect(log.body.data.deliveries).toHaveLength(2);
  });

  it('does not deliver unsubscribed events or to inactive webhooks', async () => {
    const created = await createWebhook(acme.tokens.owner, [
      'conversation.resolved',
    ]);
    const inactive = await createWebhook(acme.tokens.owner, [
      'conversation.created',
    ]);
    await request(app)
      .patch(`/api/v1/integrations/webhooks/${inactive.body.data.webhook.id}`)
      .set(authHeader(acme.tokens.owner))
      .send({ isActive: false });

    const calls: string[] = [];
    setOutboundWebhookTransportForTesting(async (url) => {
      calls.push(url);
      return { status: 200 };
    });

    await mockInbound(acme.tokens.owner, 'wh2');
    expect(calls).toHaveLength(0);
    expect(
      await prisma.outboundWebhookDelivery.count({
        where: { webhookId: created.body.data.webhook.id },
      }),
    ).toBe(0);
  });

  it('retries 3 times, then logs a failed delivery and bumps failureCount', async () => {
    const created = await createWebhook(acme.tokens.owner, [
      'conversation.created',
    ]);
    const webhookId = created.body.data.webhook.id;

    let attempts = 0;
    setOutboundWebhookTransportForTesting(async () => {
      attempts += 1;
      return { status: 500 };
    });

    await mockInbound(acme.tokens.owner, 'wh3');

    expect(attempts).toBe(3);
    const deliveries = await prisma.outboundWebhookDelivery.findMany({
      where: { webhookId },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe('failed');
    expect(deliveries[0].attemptCount).toBe(3);
    expect(deliveries[0].responseStatus).toBe(500);
    expect(deliveries[0].errorMessage).toContain('500');

    const webhook = await prisma.outboundWebhook.findUnique({
      where: { id: webhookId },
    });
    expect(webhook!.failureCount).toBe(1);
    expect(webhook!.lastFailureAt).not.toBeNull();
    expect(webhook!.isActive).toBe(true); // below the auto-disable threshold
  });

  it('a transport error (timeout/network) also retries and is logged', async () => {
    const created = await createWebhook(acme.tokens.owner, [
      'conversation.created',
    ]);
    setOutboundWebhookTransportForTesting(async () => {
      throw new Error('connect ETIMEDOUT');
    });

    await mockInbound(acme.tokens.owner, 'wh4');

    const delivery = await prisma.outboundWebhookDelivery.findFirst({
      where: { webhookId: created.body.data.webhook.id },
    });
    expect(delivery!.status).toBe('failed');
    expect(delivery!.attemptCount).toBe(3);
    expect(delivery!.responseStatus).toBeNull();
    expect(delivery!.errorMessage).toContain('ETIMEDOUT');
  });

  it('auto-disables after 20 consecutive failures and success resets the streak', async () => {
    const created = await createWebhook(acme.tokens.owner, [
      'conversation.created',
    ]);
    const webhookId = created.body.data.webhook.id;
    await prisma.outboundWebhook.update({
      where: { id: webhookId },
      data: { failureCount: 19 },
    });

    setOutboundWebhookTransportForTesting(async () => ({ status: 503 }));
    await mockInbound(acme.tokens.owner, 'wh5');

    const disabled = await prisma.outboundWebhook.findUnique({
      where: { id: webhookId },
    });
    expect(disabled!.failureCount).toBe(20);
    expect(disabled!.isActive).toBe(false);

    // Re-enabling clears the streak; a successful delivery keeps it at 0.
    await request(app)
      .patch(`/api/v1/integrations/webhooks/${webhookId}`)
      .set(authHeader(acme.tokens.owner))
      .send({ isActive: true });
    setOutboundWebhookTransportForTesting(async () => ({ status: 204 }));
    await mockInbound(acme.tokens.owner, 'wh6', 'cust-2');

    const healthy = await prisma.outboundWebhook.findUnique({
      where: { id: webhookId },
    });
    expect(healthy!.failureCount).toBe(0);
    expect(healthy!.isActive).toBe(true);
    expect(healthy!.lastSuccessAt).not.toBeNull();
  });
});
