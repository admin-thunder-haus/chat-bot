import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';
import { prisma } from './setup';
import { setAIProviderForTesting } from '../src/modules/ai';
import { makeFakeProvider } from './ai-helpers';
import { setInstagramTransportForTesting } from '../src/modules/channels';
import {
  connectInstagram,
  makeInstagramTransport,
  igTextPayload,
  igReadPayload,
  igAttachmentPayload,
  igVerify,
  igWebhook,
  IG,
} from './instagram-helpers';

const app = createApp();
let acme: Tenant;
let globex: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
  setInstagramTransportForTesting(makeInstagramTransport().transport);
});
afterEach(() => {
  setInstagramTransportForTesting(null);
  setAIProviderForTesting(null);
});

async function connectedAccountId(tenant: Tenant, overrides = {}): Promise<string> {
  const res = await connectInstagram(app, tenant.tokens.owner, overrides);
  return res.body.data.account.id;
}

describe('Instagram — connect', () => {
  it('connects an IG account (OWNER), validates against Meta, and stores credentials encrypted', async () => {
    const res = await connectInstagram(app, acme.tokens.owner);
    expect(res.status).toBe(201);
    const acc = res.body.data.account;
    expect(acc.channelType).toBe('INSTAGRAM');
    expect(acc.externalAccountId).toBe(IG.instagramAccountId);
    expect(acc.externalPageId).toBe(IG.facebookPageId);
    // Validated on connect -> HEALTHY (mocked Graph API).
    expect(acc.connectionState).toBe('HEALTHY');

    const cred = await prisma.channelCredential.findFirst({
      where: { channelAccountId: acc.id },
    });
    expect(cred).not.toBeNull();
    expect(cred!.encryptedPayload).not.toContain(IG.accessToken);
    expect(cred!.encryptedPayload).not.toContain(IG.appSecret);
  });

  it('never returns secrets in the API response', async () => {
    const res = await connectInstagram(app, acme.tokens.owner);
    const dump = JSON.stringify(res.body);
    expect(dump).not.toContain(IG.accessToken);
    expect(dump).not.toContain(IG.appSecret);
    expect(dump).not.toContain(IG.verifyToken);
    expect(dump).not.toContain('encryptedPayload');
  });

  it('ADMIN can connect; AGENT cannot', async () => {
    const admin = await connectInstagram(app, acme.tokens.admin, { instagramAccountId: '17841400000000002' });
    expect(admin.status).toBe(201);
    const agent = await connectInstagram(app, acme.tokens.agent, { instagramAccountId: '17841400000000003' });
    expect(agent.status).toBe(403);
  });

  it('validates required fields and rejects unknown fields (companyId)', async () => {
    const missing = await connectInstagram(app, acme.tokens.owner, { instagramAccountId: '' });
    expect(missing.status).toBe(400);
    const injected = await connectInstagram(app, acme.tokens.owner, { companyId: globex.company.id });
    expect(injected.status).toBe(400);
  });

  it('rejects a duplicate IG account in the same company (409)', async () => {
    await connectInstagram(app, acme.tokens.owner);
    const dup = await connectInstagram(app, acme.tokens.owner);
    expect(dup.status).toBe(409);
  });

  it('allows the same external IG id in a different tenant', async () => {
    await connectInstagram(app, acme.tokens.owner);
    const other = await connectInstagram(app, globex.tokens.owner);
    expect(other.status).toBe(201);
  });

  it('does not report false success when credentials fail validation', async () => {
    setInstagramTransportForTesting(
      makeInstagramTransport({ check: () => ({ status: 401, ok: false, json: { error: { code: 190 } } }) }).transport,
    );
    const res = await connectInstagram(app, acme.tokens.owner);
    expect(res.status).toBe(201); // account saved (recoverable pending state)
    expect(res.body.data.account.connectionState).toBe('AUTH_EXPIRED');
    expect(res.body.message).not.toMatch(/verified and active/i);
  });

  it('blocks cross-tenant access to a connected account (404)', async () => {
    const id = await connectedAccountId(acme);
    const cross = await request(app)
      .get(`/api/v1/channels/${id}`)
      .set(authHeader(globex.tokens.owner));
    expect(cross.status).toBe(404);
  });
});

describe('Instagram — Meta webhook verification & signature', () => {
  it('echoes the challenge for a valid verify token', async () => {
    const id = await connectedAccountId(acme);
    const res = await igVerify(app, id, {
      'hub.mode': 'subscribe',
      'hub.verify_token': IG.verifyToken,
      'hub.challenge': 'ig-challenge-123',
    });
    expect(res.status).toBe(200);
    expect(res.text).toBe('ig-challenge-123');
  });

  it('rejects an invalid verify token and does not leak unknown-account existence', async () => {
    const id = await connectedAccountId(acme);
    const bad = await igVerify(app, id, { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'x' });
    expect(bad.status).toBe(403);
    // An arbitrary non-existent account id returns the SAME generic 403.
    const unknown = await igVerify(app, '00000000-0000-0000-0000-000000000000', {
      'hub.mode': 'subscribe',
      'hub.verify_token': IG.verifyToken,
      'hub.challenge': 'x',
    });
    expect(unknown.status).toBe(403);
  });

  it('accepts a correctly-signed webhook and rejects bad/missing signatures', async () => {
    const id = await connectedAccountId(acme);
    const body = igTextPayload({ mid: 'ig.IN.sig', text: 'Hi' });
    expect((await igWebhook(app, id, body)).status).toBe(200);
    expect((await igWebhook(app, id, body, { badSignature: true })).status).toBe(401);
    // Missing signature header entirely -> 401.
    const noSig = await request(app)
      .post(`/api/v1/webhooks/instagram/${id}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body));
    expect(noSig.status).toBe(401);
  });
});

describe('Instagram — incoming pipeline (shared, no special cases)', () => {
  it('creates customer + conversation + message from an inbound text', async () => {
    const id = await connectedAccountId(acme);
    const res = await igWebhook(app, id, igTextPayload({ mid: 'ig.IN.1', text: 'Hello Instagram' }));
    expect(res.body.data.processed).toBe(1);

    const customer = await prisma.customer.findFirst({
      where: { companyId: acme.company.id, channelType: 'INSTAGRAM', externalId: IG.customerIgsid },
    });
    expect(customer).not.toBeNull();
    const conv = await prisma.conversation.findFirst({
      where: { companyId: acme.company.id, customerId: customer!.id },
    });
    expect(conv?.channelAccountId).toBe(id);
    expect(conv?.channelType).toBe('INSTAGRAM');
    const msg = await prisma.message.findFirst({ where: { conversationId: conv!.id } });
    expect(msg?.content).toBe('Hello Instagram');
    expect(msg?.externalMessageId).toBe('ig.IN.1');
  });

  it('is idempotent: a duplicate message id does not duplicate the message or AI reply', async () => {
    setAIProviderForTesting(makeFakeProvider({ text: 'IG AI reply.' }).provider);
    await prisma.companyAISettings.upsert({
      where: { companyId: acme.company.id },
      create: { companyId: acme.company.id, autoReplyEnabled: true },
      update: { autoReplyEnabled: true },
    });
    const id = await connectedAccountId(acme);
    const body = igTextPayload({ mid: 'ig.DUP', text: 'hours?' });
    await igWebhook(app, id, body);
    const second = await igWebhook(app, id, body);
    expect(second.body.data.duplicates).toBe(1);
    expect(await prisma.message.count({ where: { companyId: acme.company.id, senderType: 'CUSTOMER' } })).toBe(1);
    expect(await prisma.message.count({ where: { companyId: acme.company.id, senderType: 'AI' } })).toBe(1);
  });

  it('records unsupported (media) inbound without creating a message', async () => {
    const id = await connectedAccountId(acme);
    const res = await igWebhook(app, id, igAttachmentPayload({ mid: 'ig.IMG', type: 'image' }));
    expect(res.body.data.ignored).toBe(1);
    expect(await prisma.message.count({ where: { companyId: acme.company.id } })).toBe(0);
  });

  it('triggers the existing AI auto-reply automatically', async () => {
    setAIProviderForTesting(makeFakeProvider({ text: 'Instagram AI reply.' }).provider);
    await prisma.companyAISettings.upsert({
      where: { companyId: acme.company.id },
      create: { companyId: acme.company.id, autoReplyEnabled: true },
      update: { autoReplyEnabled: true },
    });
    const id = await connectedAccountId(acme);
    await igWebhook(app, id, igTextPayload({ mid: 'ig.AI', text: 'What are your hours?' }));
    const conv = await prisma.conversation.findFirst({ where: { companyId: acme.company.id, channelType: 'INSTAGRAM' } });
    const ai = await prisma.message.findFirst({ where: { conversationId: conv!.id, senderType: 'AI' } });
    expect(ai?.content).toBe('Instagram AI reply.');
  });

  it('keeps identical external sender IDs isolated across tenants', async () => {
    const acmeId = await connectedAccountId(acme);
    const globexId = await connectedAccountId(globex);
    await igWebhook(app, acmeId, igTextPayload({ mid: 'ig.shared', from: IG.customerIgsid, text: 'acme' }));
    await igWebhook(app, globexId, igTextPayload({ mid: 'ig.shared', from: IG.customerIgsid, text: 'globex' }));
    // Same IGSID + same message id, different tenants -> one message each, isolated.
    expect(await prisma.message.count({ where: { companyId: acme.company.id } })).toBe(1);
    expect(await prisma.message.count({ where: { companyId: globex.company.id } })).toBe(1);
  });
});

describe('Instagram — outbound send', () => {
  async function inboundConversation(tenant: Tenant) {
    const id = await connectedAccountId(tenant);
    await igWebhook(app, id, igTextPayload({ mid: `in-${id}`, text: 'hi' }));
    const conv = await prisma.conversation.findFirst({
      where: { companyId: tenant.company.id, channelType: 'INSTAGRAM' },
    });
    return { accountId: id, conversationId: conv!.id };
  }

  it('sends an agent reply through the delivery engine + Graph API and records the message id', async () => {
    const { conversationId } = await inboundConversation(acme);
    const res = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set(authHeader(acme.tokens.owner))
      .send({ content: 'Thanks for the DM!' });
    expect(res.status).toBe(201);
    expect(res.body.data.message.status).toBe('SENT');
    const delivery = await prisma.channelDelivery.findFirst({
      where: { messageId: res.body.data.message.id },
    });
    expect(delivery?.status).toBe('SENT');
    expect(delivery?.externalMessageId).toMatch(/^ig\.OUT\./);
  });

  it('never sends internal notes through the provider', async () => {
    const { conversationId } = await inboundConversation(acme);
    const res = await request(app)
      .post(`/api/v1/conversations/${conversationId}/notes`)
      .set(authHeader(acme.tokens.owner))
      .send({ content: 'internal only — do not send' });
    expect(res.status).toBe(201);
    // No delivery row for a note.
    const deliveries = await prisma.channelDelivery.count({
      where: { channelAccount: { companyId: acme.company.id } },
    });
    expect(deliveries).toBe(0);
  });

  it('classifies a permanent (auth) send failure and marks the delivery FAILED', async () => {
    const { conversationId } = await inboundConversation(acme);
    setInstagramTransportForTesting(
      makeInstagramTransport({ send: () => ({ status: 401, ok: false, json: { error: { code: 190 } } }) }).transport,
    );
    const res = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set(authHeader(acme.tokens.owner))
      .send({ content: 'will fail' });
    expect(res.status).toBe(201);
    const delivery = await prisma.channelDelivery.findFirst({
      where: { messageId: res.body.data.message.id },
    });
    expect(delivery?.status).toBe('FAILED');
    expect(delivery?.failureCode).toBe('IG_AUTH');
  });

  it('applies a read receipt to a sent message', async () => {
    const { accountId, conversationId } = await inboundConversation(acme);
    const sent = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set(authHeader(acme.tokens.owner))
      .send({ content: 'seen soon' });
    const mid = (
      await prisma.channelDelivery.findFirst({ where: { messageId: sent.body.data.message.id } })
    )!.externalMessageId!;
    await igWebhook(app, accountId, igReadPayload({ mid }));
    const d = await prisma.channelDelivery.findFirst({ where: { externalMessageId: mid } });
    expect(d?.status).toBe('READ');
  });

  it('blocks a cross-tenant agent from sending through the account', async () => {
    const { conversationId } = await inboundConversation(acme);
    const res = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set(authHeader(globex.tokens.owner))
      .send({ content: 'intrusion' });
    expect(res.status).toBe(404);
  });
});

describe('Instagram — health, diagnostics, tenant isolation', () => {
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

  it('AGENT cannot trigger a health check (privileged action)', async () => {
    const id = await connectedAccountId(acme);
    const res = await request(app)
      .post(`/api/v1/channels/${id}/health-check`)
      .set(authHeader(acme.tokens.agent));
    expect(res.status).toBe(403);
  });

  it('diagnostics never leak credentials (all roles read-only)', async () => {
    const id = await connectedAccountId(acme);
    const res = await request(app)
      .get(`/api/v1/channels/${id}/diagnostics`)
      .set(authHeader(acme.tokens.agent));
    expect(res.status).toBe(200);
    const dump = JSON.stringify(res.body);
    expect(dump).not.toContain(IG.accessToken);
    expect(dump).not.toContain(IG.appSecret);
    expect(dump).not.toContain('encryptedPayload');
  });

  it('is tenant-isolated: cross-tenant webhook is blocked with no data written', async () => {
    const acmeId = await connectedAccountId(acme);
    // globex signs with ITS OWN secret but targets acme's account -> 401.
    const res = await igWebhook(
      app,
      acmeId,
      igTextPayload({ mid: 'x', from: '1', text: 'intrusion' }),
      { appSecret: 'globex-different-secret' },
    );
    expect(res.status).toBe(401);
    expect(await prisma.message.count({ where: { companyId: globex.company.id } })).toBe(0);
  });
});
