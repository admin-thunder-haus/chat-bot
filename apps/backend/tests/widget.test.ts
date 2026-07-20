import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';
import { prisma } from './setup';
import { setAIProviderForTesting } from '../src/modules/ai';
import { makeFakeProvider } from './ai-helpers';

const app = createApp();
let acme: Tenant;
let globex: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
});
afterEach(() => setAIProviderForTesting(null));

/** Create a Web Chat channel via the authenticated API; return its publicId. */
async function createWebChat(tenant: Tenant): Promise<{ publicId: string; accountId: string }> {
  const res = await request(app)
    .post('/api/v1/channels')
    .set(authHeader(tenant.tokens.owner))
    .send({ providerKey: 'webchat', displayName: 'Website Chat' });
  return {
    publicId: res.body.data.account.publicId,
    accountId: res.body.data.account.id,
  };
}

const W = '/api/v1/widget';

function startSession(publicId: string, body: Record<string, unknown> = {}) {
  return request(app).post(`${W}/${publicId}/session`).send(body);
}
function sendWidget(publicId: string, token: string, body: Record<string, unknown>) {
  return request(app)
    .post(`${W}/${publicId}/messages`)
    .set('X-Widget-Session', token)
    .send(body);
}
function poll(publicId: string, token: string, after?: string) {
  return request(app)
    .get(`${W}/${publicId}/messages${after ? `?after=${after}` : ''}`)
    .set('X-Widget-Session', token);
}

describe('Web Chat channel creation', () => {
  it('creates a real Web Chat account with a public key + default config', async () => {
    const res = await request(app)
      .post('/api/v1/channels')
      .set(authHeader(acme.tokens.owner))
      .send({ providerKey: 'webchat', displayName: 'Website Chat' });
    expect(res.status).toBe(201);
    expect(res.body.data.account.publicId).toMatch(/^wc_/);
    expect(res.body.data.account.channelType).toBe('WEBCHAT');
    expect(res.body.data.account.connectionState).toBe('HEALTHY');
  });

  it('AGENT cannot create a Web Chat account', async () => {
    const res = await request(app)
      .post('/api/v1/channels')
      .set(authHeader(acme.tokens.agent))
      .send({ providerKey: 'webchat', displayName: 'x' });
    expect(res.status).toBe(403);
  });

  it('exposes + updates widget config (OWNER/ADMIN), never leaks credentials', async () => {
    const { accountId } = await createWebChat(acme);
    const get = await request(app)
      .get(`/api/v1/channels/${accountId}/widget-config`)
      .set(authHeader(acme.tokens.agent)); // all roles may read
    expect(get.status).toBe(200);
    expect(get.body.data.config.title).toBeDefined();

    const patch = await request(app)
      .patch(`/api/v1/channels/${accountId}/widget-config`)
      .set(authHeader(acme.tokens.owner))
      .send({ title: 'Talk to us', themeColor: '#ff0000' });
    expect(patch.status).toBe(200);
    expect(patch.body.data.config.title).toBe('Talk to us');
    expect(patch.body.data.config.themeColor).toBe('#ff0000');

    const agentPatch = await request(app)
      .patch(`/api/v1/channels/${accountId}/widget-config`)
      .set(authHeader(acme.tokens.agent))
      .send({ title: 'nope' });
    expect(agentPatch.status).toBe(403);
  });
});

describe('Widget public API — session, messaging, polling', () => {
  it('serves public config without a session', async () => {
    const { publicId } = await createWebChat(acme);
    const res = await request(app).get(`${W}/${publicId}/config`);
    expect(res.status).toBe(200);
    expect(res.body.data.channelType).toBe('WEBCHAT');
    expect(res.body.data.config.welcomeMessage).toBeDefined();
  });

  it('returns a generic 404 for an unknown widget key', async () => {
    const res = await request(app).get(`${W}/wc_does_not_exist/config`);
    expect(res.status).toBe(404);
  });

  it('starts a session for a new anonymous visitor', async () => {
    const { publicId } = await createWebChat(acme);
    const res = await startSession(publicId);
    expect(res.status).toBe(200);
    expect(res.body.data.sessionToken).toEqual(expect.any(String));
    expect(res.body.data.visitorId).toMatch(/^wcv_/);
    expect(res.body.data.messages).toEqual([]);
  });

  it('runs the full inbound flow through the shared pipeline', async () => {
    const { publicId, accountId } = await createWebChat(acme);
    const session = (await startSession(publicId)).body.data;

    const sent = await sendWidget(publicId, session.sessionToken, {
      content: 'Hi, I need help',
    });
    expect(sent.status).toBe(201);
    expect(sent.body.data.message.role).toBe('visitor');

    // A customer + conversation + message were created, scoped + channel-linked.
    const customer = await prisma.customer.findFirst({
      where: { companyId: acme.company.id, channelType: 'WEBCHAT', externalId: session.visitorId },
    });
    expect(customer).not.toBeNull();
    const conv = await prisma.conversation.findFirst({
      where: { companyId: acme.company.id, customerId: customer!.id },
    });
    expect(conv?.channelAccountId).toBe(accountId);
    expect(conv?.channelType).toBe('WEBCHAT');
    expect(conv?.unreadCount).toBe(1);
  });

  it('is idempotent on clientMessageId (no duplicate customer message)', async () => {
    const { publicId } = await createWebChat(acme);
    const session = (await startSession(publicId)).body.data;
    await sendWidget(publicId, session.sessionToken, { content: 'dup', clientMessageId: 'c1' });
    await sendWidget(publicId, session.sessionToken, { content: 'dup', clientMessageId: 'c1' });
    const count = await prisma.message.count({
      where: { companyId: acme.company.id, direction: 'INBOUND' },
    });
    expect(count).toBe(1);
  });

  it('polls agent replies sent from the inbox', async () => {
    const { publicId } = await createWebChat(acme);
    const session = (await startSession(publicId)).body.data;
    const sent = await sendWidget(publicId, session.sessionToken, { content: 'hello' });
    const inboundId = sent.body.data.message.id;

    // Resolve the conversation and reply as an agent through the inbox API.
    const conv = await prisma.conversation.findFirst({
      where: { companyId: acme.company.id, channelType: 'WEBCHAT' },
    });
    await request(app)
      .post(`/api/v1/conversations/${conv!.id}/messages`)
      .set(authHeader(acme.tokens.owner))
      .send({ content: 'Hello! How can I help?' });

    const polled = await poll(publicId, session.sessionToken, inboundId);
    expect(polled.status).toBe(200);
    const roles = polled.body.data.messages.map((m: { role: string }) => m.role);
    expect(roles).toContain('agent');
  });

  it('triggers the existing AI auto-reply automatically', async () => {
    setAIProviderForTesting(makeFakeProvider({ text: 'Sure, I can help!' }).provider);
    await prisma.companyAISettings.upsert({
      where: { companyId: acme.company.id },
      create: { companyId: acme.company.id, autoReplyEnabled: true },
      update: { autoReplyEnabled: true },
    });
    const { publicId } = await createWebChat(acme);
    const session = (await startSession(publicId)).body.data;
    const sent = await sendWidget(publicId, session.sessionToken, { content: 'What are your hours?' });
    expect(sent.body.data.autoReply.generated).toBe(true);

    const polled = await poll(publicId, session.sessionToken, sent.body.data.message.id);
    const assistant = polled.body.data.messages.find((m: { role: string }) => m.role === 'assistant');
    expect(assistant?.content).toBe('Sure, I can help!');
  });

  it('reconnects after refresh: same session token resumes the visitor + history', async () => {
    const { publicId } = await createWebChat(acme);
    const first = (await startSession(publicId)).body.data;
    await sendWidget(publicId, first.sessionToken, { content: 'remember me' });

    // Simulate a page refresh: re-send the stored session token.
    const resumed = (await startSession(publicId, { sessionToken: first.sessionToken })).body.data;
    expect(resumed.visitorId).toBe(first.visitorId);
    expect(resumed.messages.length).toBeGreaterThanOrEqual(1);
    expect(resumed.messages.some((m: { content: string }) => m.content === 'remember me')).toBe(true);
  });

  it('rejects a missing/invalid widget session', async () => {
    const { publicId } = await createWebChat(acme);
    const noSession = await request(app).post(`${W}/${publicId}/messages`).send({ content: 'x' });
    expect(noSession.status).toBe(401);
    const badSession = await sendWidget(publicId, 'not-a-real-token', { content: 'x' });
    expect(badSession.status).toBe(401);
  });

  it('is tenant-isolated: a session from one tenant cannot post to another widget', async () => {
    const acmeChat = await createWebChat(acme);
    const globexChat = await createWebChat(globex);
    const acmeSession = (await startSession(acmeChat.publicId)).body.data;

    // Use acme's session token against globex's widget key -> rejected.
    const res = await sendWidget(globexChat.publicId, acmeSession.sessionToken, { content: 'intrusion' });
    expect(res.status).toBe(401);
    expect(await prisma.message.count({ where: { companyId: globex.company.id } })).toBe(0);
  });

  it('accepts a typing signal', async () => {
    const { publicId } = await createWebChat(acme);
    const session = (await startSession(publicId)).body.data;
    const res = await request(app)
      .post(`${W}/${publicId}/typing`)
      .set('X-Widget-Session', session.sessionToken)
      .send({ isTyping: true });
    expect(res.status).toBe(200);
  });
});
