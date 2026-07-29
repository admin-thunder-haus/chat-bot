import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';
import { drainJobs } from './jobs-helpers';
import { prisma } from './setup';
import { setAIProviderForTesting } from '../src/modules/ai';
import { makeFakeProvider } from './ai-helpers';
import { setWhatsAppTransportForTesting } from '../src/modules/channels';
import {
  connectWhatsApp,
  makeWhatsAppTransport,
  metaStatusPayload,
  metaTextPayload,
  waVerify,
  waWebhook,
  WA,
} from './whatsapp-helpers';

const app = createApp();
let acme: Tenant;
let globex: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
  setWhatsAppTransportForTesting(makeWhatsAppTransport().transport);
});
afterEach(() => {
  setWhatsAppTransportForTesting(null);
  setAIProviderForTesting(null);
});

async function connectedAccountId(tenant: Tenant, overrides = {}): Promise<string> {
  const res = await connectWhatsApp(app, tenant.tokens.owner, overrides);
  return res.body.data.account.id;
}

describe('WhatsApp — connect', () => {
  it('connects a WhatsApp number (OWNER/ADMIN) and stores credentials encrypted', async () => {
    const res = await connectWhatsApp(app, acme.tokens.owner);
    expect(res.status).toBe(201);
    const acc = res.body.data.account;
    expect(acc.channelType).toBe('WHATSAPP');
    expect(acc.externalAccountId).toBe(WA.phoneNumberId);
    expect(acc.externalPageId).toBe(WA.wabaId);
    expect(acc.status).toBe('CONNECTED');

    // A credential row exists and is ENCRYPTED (not the plaintext secrets).
    const cred = await prisma.channelCredential.findFirst({
      where: { channelAccountId: acc.id },
    });
    expect(cred).not.toBeNull();
    expect(cred!.encryptedPayload).not.toContain(WA.accessToken);
    expect(cred!.encryptedPayload).not.toContain(WA.appSecret);
  });

  it('never returns secrets in the API response', async () => {
    const res = await connectWhatsApp(app, acme.tokens.owner);
    const dump = JSON.stringify(res.body);
    expect(dump).not.toContain(WA.accessToken);
    expect(dump).not.toContain(WA.appSecret);
    expect(dump).not.toContain(WA.verifyToken);
    expect(dump).not.toContain('encryptedPayload');
  });

  it('AGENT cannot connect WhatsApp', async () => {
    const res = await connectWhatsApp(app, acme.tokens.agent);
    expect(res.status).toBe(403);
  });

  it('validates required fields', async () => {
    const res = await request(app)
      .post('/api/v1/channels/whatsapp/connect')
      .set(authHeader(acme.tokens.owner))
      .send({ displayName: 'WA', phoneNumberId: '123' });
    expect(res.status).toBe(400);
  });

  it('rejects connecting the same phone number twice (per company)', async () => {
    await connectWhatsApp(app, acme.tokens.owner);
    const dup = await connectWhatsApp(app, acme.tokens.owner);
    expect(dup.status).toBe(409);
  });
});

describe('WhatsApp — Meta webhook verification & signature', () => {
  it('echoes the challenge for a valid verify token', async () => {
    const id = await connectedAccountId(acme);
    const res = await waVerify(app, id, {
      'hub.mode': 'subscribe',
      'hub.verify_token': WA.verifyToken,
      'hub.challenge': 'meta-challenge-123',
    });
    expect(res.status).toBe(200);
    expect(res.text).toBe('meta-challenge-123');
  });

  it('rejects an invalid verify token', async () => {
    const id = await connectedAccountId(acme);
    const res = await waVerify(app, id, {
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong',
      'hub.challenge': 'x',
    });
    expect(res.status).toBe(403);
  });

  it('accepts a correctly-signed webhook and rejects a bad signature', async () => {
    const id = await connectedAccountId(acme);
    const body = metaTextPayload({ wamid: 'wamid.IN.sig', from: '15551230001', text: 'Hi' });
    const good = await waWebhook(app, id, body);
    expect(good.status).toBe(200);
    const bad = await waWebhook(app, id, body, { badSignature: true });
    expect(bad.status).toBe(401);
  });
});

describe('WhatsApp — incoming pipeline (shared, no special cases)', () => {
  it('creates customer + conversation + message from an inbound text', async () => {
    const id = await connectedAccountId(acme);
    const res = await waWebhook(
      app,
      id,
      metaTextPayload({ wamid: 'wamid.IN.1', from: '15551230002', text: 'Hello WhatsApp', name: 'Grace' }),
    );
    expect(res.body.data.processed).toBe(1);

    const customer = await prisma.customer.findFirst({
      where: { companyId: acme.company.id, channelType: 'WHATSAPP', externalId: '15551230002' },
    });
    expect(customer?.fullName).toBe('Grace');
    const conv = await prisma.conversation.findFirst({
      where: { companyId: acme.company.id, customerId: customer!.id },
    });
    expect(conv?.channelAccountId).toBe(id);
    expect(conv?.channelType).toBe('WHATSAPP');
    const msg = await prisma.message.findFirst({ where: { conversationId: conv!.id } });
    expect(msg?.content).toBe('Hello WhatsApp');
    expect(msg?.externalMessageId).toBe('wamid.IN.1');
  });

  it('is idempotent: a duplicate message wamid does not duplicate the message', async () => {
    const id = await connectedAccountId(acme);
    const body = metaTextPayload({ wamid: 'wamid.DUP', from: '15551230003', text: 'once' });
    await waWebhook(app, id, body);
    const second = await waWebhook(app, id, body);
    expect(second.body.data.duplicates).toBe(1);
    expect(await prisma.message.count({ where: { companyId: acme.company.id } })).toBe(1);
  });

  it('records unsupported (media) inbound without creating a message', async () => {
    const id = await connectedAccountId(acme);
    const body = metaTextPayload({ wamid: 'wamid.IMG', from: '15551230004', text: 'x' });
    (body.entry[0].changes[0].value.messages[0] as { type: string }).type = 'image';
    const res = await waWebhook(app, id, body);
    expect(res.body.data.ignored).toBe(1);
    expect(await prisma.message.count({ where: { companyId: acme.company.id } })).toBe(0);
  });

  it('triggers the existing AI auto-reply automatically', async () => {
    setAIProviderForTesting(makeFakeProvider({ text: 'WhatsApp AI reply.' }).provider);
    await prisma.companyAISettings.upsert({
      where: { companyId: acme.company.id },
      create: { companyId: acme.company.id, autoReplyEnabled: true },
      update: { autoReplyEnabled: true },
    });
    const id = await connectedAccountId(acme);
    await waWebhook(app, id, metaTextPayload({ wamid: 'wamid.AI', from: '15551230005', text: 'What are your hours?' }));
    // The auto-reply is a background job — the webhook must not wait on OpenAI.
    await drainJobs();
    const conv = await prisma.conversation.findFirst({ where: { companyId: acme.company.id, channelType: 'WHATSAPP' } });
    const ai = await prisma.message.findFirst({ where: { conversationId: conv!.id, senderType: 'AI' } });
    expect(ai?.content).toBe('WhatsApp AI reply.');
  });
});

describe('WhatsApp — outbound send + status callbacks', () => {
  async function inboundConversation(tenant: Tenant) {
    const id = await connectedAccountId(tenant);
    await waWebhook(app, id, metaTextPayload({ wamid: `in-${id}`, from: '15551239999', text: 'hi' }));
    const conv = await prisma.conversation.findFirst({
      where: { companyId: tenant.company.id, channelType: 'WHATSAPP' },
    });
    return { accountId: id, conversationId: conv!.id };
  }

  it('sends an agent reply through the delivery engine + Graph API and records the wamid', async () => {
    const { conversationId } = await inboundConversation(acme);
    const res = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set(authHeader(acme.tokens.owner))
      .send({ content: 'Thanks for reaching out!' });
    expect(res.status).toBe(201);
    expect(res.body.data.message.status).toBe('SENT');
    const delivery = await prisma.channelDelivery.findFirst({
      where: { messageId: res.body.data.message.id },
    });
    expect(delivery?.status).toBe('SENT');
    expect(delivery?.externalMessageId).toMatch(/^wamid\.OUT\./);
  });

  it('applies delivered -> read status callbacks (monotonic, idempotent)', async () => {
    const { accountId, conversationId } = await inboundConversation(acme);
    const sent = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set(authHeader(acme.tokens.owner))
      .send({ content: 'On its way' });
    const wamid = (
      await prisma.channelDelivery.findFirst({ where: { messageId: sent.body.data.message.id } })
    )!.externalMessageId!;

    await waWebhook(app, accountId, metaStatusPayload({ wamid, status: 'delivered' }));
    let d = await prisma.channelDelivery.findFirst({ where: { externalMessageId: wamid } });
    expect(d?.status).toBe('DELIVERED');

    // Duplicate delivered -> not applied again.
    const dup = await waWebhook(app, accountId, metaStatusPayload({ wamid, status: 'delivered' }));
    expect(dup.body.data.duplicates).toBe(1);

    await waWebhook(app, accountId, metaStatusPayload({ wamid, status: 'read' }));
    d = await prisma.channelDelivery.findFirst({ where: { externalMessageId: wamid } });
    expect(d?.status).toBe('READ');
  });
});

describe('WhatsApp — health, diagnostics, tenant isolation', () => {
  it('health check reports HEALTHY (mocked Graph API) and records a sample', async () => {
    const id = await connectedAccountId(acme);
    const res = await request(app)
      .post(`/api/v1/channels/${id}/health-check`)
      .set(authHeader(acme.tokens.owner));
    expect(res.body.data.account.connectionState).toBe('HEALTHY');
    const sample = await prisma.channelHealthCheck.findFirst({
      where: { channelAccountId: id, checkType: 'MANUAL' },
    });
    expect(sample?.state).toBe('HEALTHY');
  });

  it('health check reports AUTH_EXPIRED on an invalid token', async () => {
    setWhatsAppTransportForTesting(
      makeWhatsAppTransport({ check: () => ({ status: 401, ok: false, json: { error: { code: 190 } } }) }).transport,
    );
    const id = await connectedAccountId(acme);
    const res = await request(app)
      .post(`/api/v1/channels/${id}/health-check`)
      .set(authHeader(acme.tokens.owner));
    expect(res.body.data.account.connectionState).toBe('AUTH_EXPIRED');
  });

  it('diagnostics never leak credentials', async () => {
    const id = await connectedAccountId(acme);
    const res = await request(app)
      .get(`/api/v1/channels/${id}/diagnostics`)
      .set(authHeader(acme.tokens.agent));
    expect(res.status).toBe(200);
    const dump = JSON.stringify(res.body);
    expect(dump).not.toContain(WA.accessToken);
    expect(dump).not.toContain(WA.appSecret);
    expect(dump).not.toContain('encryptedPayload');
  });

  it('is tenant-isolated: cross-tenant webhook + access are blocked', async () => {
    const acmeId = await connectedAccountId(acme);
    // globex signs with ITS OWN secret but targets acme's account -> 401.
    const res = await waWebhook(
      app,
      acmeId,
      metaTextPayload({ wamid: 'x', from: '1', text: 'intrusion' }),
      { appSecret: 'globex-different-secret' },
    );
    expect(res.status).toBe(401);
    // globex cannot read acme's channel account.
    const cross = await request(app)
      .get(`/api/v1/channels/${acmeId}`)
      .set(authHeader(globex.tokens.owner));
    expect(cross.status).toBe(404);
    expect(await prisma.message.count({ where: { companyId: globex.company.id } })).toBe(0);
  });
});

/**
 * Regression: connecting must also SUBSCRIBE our app to the WABA.
 *
 * Meta splits reachability in two — the app-level callback URL says where
 * events go, the per-WABA subscription says which accounts send them. The
 * manual connect path used to do only the first half, so a channel connected
 * cleanly, reported HEALTHY, sent messages fine and silently received nothing.
 * That cost a live debugging session to find, because nothing anywhere was an
 * error.
 */
describe('WhatsApp — connect subscribes the WABA to our app', () => {
  it('POSTs to /{waba-id}/subscribed_apps during a manual connect', async () => {
    const { transport, calls } = makeWhatsAppTransport();
    setWhatsAppTransportForTesting(transport);

    const res = await connectWhatsApp(app, acme.tokens.owner);
    expect(res.status).toBe(201);

    const subscribe = calls.filter(
      (c) => c.method === 'POST' && c.url.includes('/subscribed_apps'),
    );
    expect(subscribe).toHaveLength(1);
    // The WABA, not the phone number: WhatsApp subscribes the business account.
    expect(subscribe[0].url).toContain(WA.wabaId);
  });

  it('still connects when the subscription call fails, and records why', async () => {
    // A subscription failure must not discard credentials that are valid — but
    // it must not vanish either, or we are back to the silent channel.
    const { transport } = makeWhatsAppTransport({
      subscribe: () => ({ status: 400, ok: false, json: { error: { code: 100 } } }),
    });
    setWhatsAppTransportForTesting(transport);

    const res = await connectWhatsApp(app, acme.tokens.owner);
    expect(res.status).toBe(201);

    const activities = await prisma.channelActivity.findMany({
      where: { channelAccountId: res.body.data.account.id },
      select: { activityType: true, metadata: true },
    });
    const record = activities.find(
      (a) => (a.metadata as Record<string, unknown> | null)?.webhookSubscription,
    );
    expect(record).toBeDefined();
    expect((record!.metadata as Record<string, unknown>).webhookSubscription).toBe(
      'failed',
    );
  });
});

/**
 * Regression: a health check must report INBOUND readiness separately.
 *
 * `checkConnection` only proves we can call Meta. A channel whose WABA is not
 * subscribed to our app sends fine and receives nothing, yet reported HEALTHY —
 * which is exactly why a broken channel went unnoticed for an hour. The signal
 * is reported alongside connectionState, never merged into it: a legacy channel
 * connected with the customer's own Meta app would otherwise start alarming.
 */
describe('WhatsApp — health check reports inbound readiness', () => {
  const APP_ID = '2235812173866533';

  afterEach(() => {
    delete process.env.META_APP_ID;
  });

  async function runHealth(accountId: string) {
    return request(app)
      .post(`/api/v1/channels/${accountId}/health-check`)
      .set(authHeader(acme.tokens.owner));
  }

  it('reports ready when OUR app is subscribed to the WABA', async () => {
    process.env.META_APP_ID = APP_ID;
    setWhatsAppTransportForTesting(
      makeWhatsAppTransport({
        subscribedApps: () => ({
          status: 200,
          ok: true,
          json: { data: [{ whatsapp_business_api_data: { id: APP_ID } }] },
        }),
      }).transport,
    );
    const connected = await connectWhatsApp(app, acme.tokens.owner);
    const res = await runHealth(connected.body.data.account.id);

    expect(res.status).toBe(200);
    expect(res.body.data.account.inbound.ready).toBe(true);
  });

  it('reports NOT ready when only somebody else is subscribed', async () => {
    // The real failure: the WABA was subscribed to Meta's own test app and not
    // to ours. A "list is non-empty" check would have called this healthy.
    process.env.META_APP_ID = APP_ID;
    setWhatsAppTransportForTesting(
      makeWhatsAppTransport({
        subscribedApps: () => ({
          status: 200,
          ok: true,
          json: { data: [{ whatsapp_business_api_data: { id: '999999999' } }] },
        }),
      }).transport,
    );
    const connected = await connectWhatsApp(app, acme.tokens.owner);
    const res = await runHealth(connected.body.data.account.id);

    expect(res.body.data.account.inbound.ready).toBe(false);
    expect(res.body.data.account.inbound.detail).toBe('APP_NOT_SUBSCRIBED');
    // Outbound is fine, so the channel itself must NOT be marked down.
    expect(res.body.data.account.connectionState).toBe('HEALTHY');
  });

  it('says "unknown" rather than "broken" when it cannot tell', async () => {
    // No platform app id configured (a customer using their own Meta app), so
    // our id is legitimately absent. Claiming failure here would be a false
    // alarm, and one false alarm makes every later warning ignorable.
    setWhatsAppTransportForTesting(
      makeWhatsAppTransport({
        subscribedApps: () => ({
          status: 200,
          ok: true,
          json: { data: [{ whatsapp_business_api_data: { id: 'someone-else' } }] },
        }),
      }).transport,
    );
    const connected = await connectWhatsApp(app, acme.tokens.owner);
    const res = await runHealth(connected.body.data.account.id);

    expect(res.body.data.account.inbound.ready).toBeNull();
  });

  it('is conclusive when NOTHING is subscribed, even without an app id', async () => {
    setWhatsAppTransportForTesting(
      makeWhatsAppTransport({
        subscribedApps: () => ({ status: 200, ok: true, json: { data: [] } }),
      }).transport,
    );
    const connected = await connectWhatsApp(app, acme.tokens.owner);
    const res = await runHealth(connected.body.data.account.id);

    expect(res.body.data.account.inbound.ready).toBe(false);
    expect(res.body.data.account.inbound.detail).toBe('NO_SUBSCRIBERS');
  });

  it('stays "unknown" when the subscription lookup itself fails', async () => {
    process.env.META_APP_ID = APP_ID;
    setWhatsAppTransportForTesting(
      makeWhatsAppTransport({
        subscribedApps: () => ({ status: 500, ok: false, json: null }),
      }).transport,
    );
    const connected = await connectWhatsApp(app, acme.tokens.owner);
    const res = await runHealth(connected.body.data.account.id);

    expect(res.body.data.account.inbound.ready).toBeNull();
  });
});
