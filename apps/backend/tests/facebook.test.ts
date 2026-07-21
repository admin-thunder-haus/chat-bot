import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';
import { prisma } from './setup';
import { setAIProviderForTesting } from '../src/modules/ai';
import { makeFakeProvider } from './ai-helpers';
import { setFacebookTransportForTesting } from '../src/modules/channels';
import {
  connectFacebook,
  makeFacebookTransport,
  fbTextPayload,
  fbDeliveryPayload,
  fbAttachmentPayload,
  fbVerify,
  fbWebhook,
  FB,
} from './facebook-helpers';

const app = createApp();
let acme: Tenant;
let globex: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
  setFacebookTransportForTesting(makeFacebookTransport().transport);
});
afterEach(() => {
  setFacebookTransportForTesting(null);
  setAIProviderForTesting(null);
});

async function connectedAccountId(tenant: Tenant, overrides = {}): Promise<string> {
  const res = await connectFacebook(app, tenant.tokens.owner, overrides);
  return res.body.data.account.id;
}

describe('Facebook — connect', () => {
  it('connects a Page (OWNER), validates against Meta, stores credentials encrypted', async () => {
    const res = await connectFacebook(app, acme.tokens.owner);
    expect(res.status).toBe(201);
    const acc = res.body.data.account;
    expect(acc.channelType).toBe('FACEBOOK');
    expect(acc.externalAccountId).toBe(FB.pageId);
    expect(acc.connectionState).toBe('HEALTHY');
    const cred = await prisma.channelCredential.findFirst({ where: { channelAccountId: acc.id } });
    expect(cred!.encryptedPayload).not.toContain(FB.accessToken);
    expect(cred!.encryptedPayload).not.toContain(FB.appSecret);
  });

  it('never returns secrets; AGENT cannot connect; companyId rejected', async () => {
    const res = await connectFacebook(app, acme.tokens.owner);
    const dump = JSON.stringify(res.body);
    expect(dump).not.toContain(FB.accessToken);
    expect(dump).not.toContain(FB.verifyToken);
    expect((await connectFacebook(app, acme.tokens.agent, { pageId: '2' })).status).toBe(403);
    expect((await connectFacebook(app, acme.tokens.owner, { companyId: globex.company.id })).status).toBe(400);
  });

  it('rejects a duplicate Page in the same company; allows it in another tenant', async () => {
    await connectFacebook(app, acme.tokens.owner);
    expect((await connectFacebook(app, acme.tokens.owner)).status).toBe(409);
    expect((await connectFacebook(app, globex.tokens.owner)).status).toBe(201);
  });

  it('does not report false success when credentials fail validation', async () => {
    setFacebookTransportForTesting(
      makeFacebookTransport({ check: () => ({ status: 401, ok: false, json: { error: { code: 190 } } }) }).transport,
    );
    const res = await connectFacebook(app, acme.tokens.owner);
    expect(res.status).toBe(201);
    expect(res.body.data.account.connectionState).toBe('AUTH_EXPIRED');
    expect(res.body.message).not.toMatch(/verified and active/i);
  });
});

describe('Facebook — webhook + incoming pipeline', () => {
  it('verifies challenge, rejects bad verify token / signature', async () => {
    const id = await connectedAccountId(acme);
    expect((await fbVerify(app, id, { 'hub.mode': 'subscribe', 'hub.verify_token': FB.verifyToken, 'hub.challenge': 'c1' })).text).toBe('c1');
    expect((await fbVerify(app, id, { 'hub.mode': 'subscribe', 'hub.verify_token': 'no', 'hub.challenge': 'x' })).status).toBe(403);
    expect((await fbWebhook(app, id, fbTextPayload({ mid: 'm.s', text: 'hi' }), { badSignature: true })).status).toBe(401);
  });

  it('creates customer + conversation + message from an inbound text (once)', async () => {
    const id = await connectedAccountId(acme);
    const res = await fbWebhook(app, id, fbTextPayload({ mid: 'm.IN.1', text: 'Hello Messenger' }));
    expect(res.body.data.processed).toBe(1);
    const customer = await prisma.customer.findFirst({ where: { companyId: acme.company.id, channelType: 'FACEBOOK', externalId: FB.customerPsid } });
    expect(customer).not.toBeNull();
    const conv = await prisma.conversation.findFirst({ where: { companyId: acme.company.id, customerId: customer!.id } });
    expect(conv?.channelAccountId).toBe(id);
    const msg = await prisma.message.findFirst({ where: { conversationId: conv!.id } });
    expect(msg?.content).toBe('Hello Messenger');
    // Idempotent replay.
    const dup = await fbWebhook(app, id, fbTextPayload({ mid: 'm.IN.1', text: 'Hello Messenger' }));
    expect(dup.body.data.duplicates).toBe(1);
    expect(await prisma.message.count({ where: { companyId: acme.company.id, senderType: 'CUSTOMER' } })).toBe(1);
  });

  it('records unsupported (attachment) inbound without creating a message', async () => {
    const id = await connectedAccountId(acme);
    const res = await fbWebhook(app, id, fbAttachmentPayload({ mid: 'm.IMG' }));
    expect(res.body.data.ignored).toBe(1);
    expect(await prisma.message.count({ where: { companyId: acme.company.id } })).toBe(0);
  });

  it('triggers the existing AI auto-reply automatically', async () => {
    setAIProviderForTesting(makeFakeProvider({ text: 'Messenger AI reply.' }).provider);
    await prisma.companyAISettings.upsert({ where: { companyId: acme.company.id }, create: { companyId: acme.company.id, autoReplyEnabled: true }, update: { autoReplyEnabled: true } });
    const id = await connectedAccountId(acme);
    await fbWebhook(app, id, fbTextPayload({ mid: 'm.AI', text: 'What are your hours?' }));
    const conv = await prisma.conversation.findFirst({ where: { companyId: acme.company.id, channelType: 'FACEBOOK' } });
    const ai = await prisma.message.findFirst({ where: { conversationId: conv!.id, senderType: 'AI' } });
    expect(ai?.content).toBe('Messenger AI reply.');
  });
});

describe('Facebook — outbound + delivery receipts', () => {
  async function inboundConversation(tenant: Tenant) {
    const id = await connectedAccountId(tenant);
    await fbWebhook(app, id, fbTextPayload({ mid: `in-${id}`, text: 'hi' }));
    const conv = await prisma.conversation.findFirst({ where: { companyId: tenant.company.id, channelType: 'FACEBOOK' } });
    return { accountId: id, conversationId: conv!.id };
  }

  it('sends an agent reply through the delivery engine and records the message id', async () => {
    const { conversationId } = await inboundConversation(acme);
    const res = await request(app).post(`/api/v1/conversations/${conversationId}/messages`).set(authHeader(acme.tokens.owner)).send({ content: 'Thanks!' });
    expect(res.status).toBe(201);
    expect(res.body.data.message.status).toBe('SENT');
    const delivery = await prisma.channelDelivery.findFirst({ where: { messageId: res.body.data.message.id } });
    expect(delivery?.status).toBe('SENT');
    expect(delivery?.externalMessageId).toMatch(/^fb\.OUT\./);
  });

  it('applies a per-mid delivery receipt to a sent message', async () => {
    const { accountId, conversationId } = await inboundConversation(acme);
    const sent = await request(app).post(`/api/v1/conversations/${conversationId}/messages`).set(authHeader(acme.tokens.owner)).send({ content: 'On its way' });
    const mid = (await prisma.channelDelivery.findFirst({ where: { messageId: sent.body.data.message.id } }))!.externalMessageId!;
    await fbWebhook(app, accountId, fbDeliveryPayload({ mids: [mid] }));
    const d = await prisma.channelDelivery.findFirst({ where: { externalMessageId: mid } });
    expect(d?.status).toBe('DELIVERED');
  });

  it('never sends internal notes; blocks cross-tenant send', async () => {
    const { conversationId } = await inboundConversation(acme);
    await request(app).post(`/api/v1/conversations/${conversationId}/notes`).set(authHeader(acme.tokens.owner)).send({ content: 'note' });
    expect(await prisma.channelDelivery.count({ where: { channelAccount: { companyId: acme.company.id } } })).toBe(0);
    const cross = await request(app).post(`/api/v1/conversations/${conversationId}/messages`).set(authHeader(globex.tokens.owner)).send({ content: 'x' });
    expect(cross.status).toBe(404);
  });
});

describe('Facebook — health, hard-delete, isolation', () => {
  it('health check reports HEALTHY; AGENT cannot; diagnostics hide secrets', async () => {
    const id = await connectedAccountId(acme);
    const health = await request(app).post(`/api/v1/channels/${id}/health-check`).set(authHeader(acme.tokens.owner));
    expect(health.body.data.account.connectionState).toBe('HEALTHY');
    expect((await request(app).post(`/api/v1/channels/${id}/health-check`).set(authHeader(acme.tokens.agent))).status).toBe(403);
    const diag = await request(app).get(`/api/v1/channels/${id}/diagnostics`).set(authHeader(acme.tokens.agent));
    expect(JSON.stringify(diag.body)).not.toContain(FB.accessToken);
  });

  it('permanently deletes a channel, freeing the slot to reconnect the same Page', async () => {
    const id = await connectedAccountId(acme);
    // Duplicate connect is blocked while it exists.
    expect((await connectFacebook(app, acme.tokens.owner)).status).toBe(409);
    // AGENT cannot delete.
    expect((await request(app).delete(`/api/v1/channels/${id}/permanent`).set(authHeader(acme.tokens.agent))).status).toBe(403);
    // OWNER hard-deletes → row gone + credentials cascaded.
    const del = await request(app).delete(`/api/v1/channels/${id}/permanent`).set(authHeader(acme.tokens.owner));
    expect(del.status).toBe(200);
    expect(await prisma.channelAccount.count({ where: { id } })).toBe(0);
    expect(await prisma.channelCredential.count({ where: { channelAccountId: id } })).toBe(0);
    // Same Page can now be reconnected fresh.
    expect((await connectFacebook(app, acme.tokens.owner)).status).toBe(201);
  });

  it('hard-delete preserves conversation history (SetNull)', async () => {
    const id = await connectedAccountId(acme);
    await fbWebhook(app, id, fbTextPayload({ mid: 'm.keep', text: 'keep me' }));
    const conv = await prisma.conversation.findFirst({ where: { companyId: acme.company.id, channelType: 'FACEBOOK' } });
    await request(app).delete(`/api/v1/channels/${id}/permanent`).set(authHeader(acme.tokens.owner));
    const still = await prisma.conversation.findFirst({ where: { id: conv!.id } });
    expect(still).not.toBeNull();
    expect(still?.channelAccountId).toBeNull();
    expect(await prisma.message.count({ where: { conversationId: conv!.id } })).toBe(1);
  });

  it('is tenant-isolated: cross-tenant webhook blocked, no data written', async () => {
    const acmeId = await connectedAccountId(acme);
    const res = await fbWebhook(app, acmeId, fbTextPayload({ mid: 'x', from: '1', text: 'intrusion' }), { appSecret: 'globex-secret' });
    expect(res.status).toBe(401);
    expect(await prisma.message.count({ where: { companyId: globex.company.id } })).toBe(0);
  });
});
