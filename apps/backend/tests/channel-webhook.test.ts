import { createApp } from '../src/app';
import { setupTenant, type Tenant } from './helpers';
import { prisma } from './setup';
import {
  createFakeChannel,
  fakeInboundBody,
  postWebhook,
  verifyWebhook,
  fakeChannel,
} from './channel-helpers';
import { setAIProviderForTesting } from '../src/modules/ai';
import { makeFakeProvider } from './ai-helpers';

const app = createApp();
let acme: Tenant;
let globex: Tenant;

async function fakeAccountId(token: string, overrides = {}): Promise<string> {
  const res = await createFakeChannel(app, token, overrides);
  return res.body.data.account.id;
}

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
});
afterEach(() => setAIProviderForTesting(null));

describe('Webhook engine — verification & signature', () => {
  it('echoes the challenge on a valid verify token', async () => {
    const id = await fakeAccountId(acme.tokens.owner);
    const res = await verifyWebhook(app, id, {
      verify_token: fakeChannel.verifyToken,
      challenge: 'abc123',
    });
    expect(res.status).toBe(200);
    expect(res.text).toBe('abc123');
  });

  it('fails verification safely on an invalid verify token', async () => {
    const id = await fakeAccountId(acme.tokens.owner);
    const res = await verifyWebhook(app, id, {
      verify_token: 'wrong',
      challenge: 'abc123',
    });
    expect(res.status).toBe(403);
  });

  it('accepts a valid signature and rejects an invalid one', async () => {
    const id = await fakeAccountId(acme.tokens.owner);
    const good = await postWebhook(app, id, fakeInboundBody({ messageId: 'm1' }));
    expect(good.status).toBe(200);

    const bad = await postWebhook(
      app,
      id,
      fakeInboundBody({ messageId: 'm2' }),
      { badSignature: true },
    );
    expect(bad.status).toBe(401);
    // Invalid signature must not have created any message.
    const count = await prisma.message.count({ where: { companyId: acme.company.id } });
    expect(count).toBe(1); // only the valid one
  });

  it('returns a safe response for an unknown provider', async () => {
    const id = await fakeAccountId(acme.tokens.owner);
    const res = await postWebhook(app, id, fakeInboundBody({ messageId: 'm1' }), {
      providerKey: 'nope',
    });
    expect(res.status).toBe(404);
  });

  it('does not leak existence of unknown accounts (valid signature)', async () => {
    // Random uuid + valid signature -> generic 200 ack, nothing processed.
    const res = await postWebhook(
      app,
      '11111111-1111-1111-1111-111111111111',
      fakeInboundBody({ messageId: 'm1' }),
    );
    expect(res.status).toBe(200);
    expect(res.body.data.processed).toBe(0);
    const junk = await postWebhook(app, 'not-a-uuid', fakeInboundBody({ messageId: 'm2' }));
    expect(junk.status).toBe(200);
    expect(junk.body.data.processed).toBe(0);
  });
});

describe('Webhook engine — incoming message pipeline', () => {
  it('creates customer, conversation, and inbound message with unread + activity', async () => {
    const id = await fakeAccountId(acme.tokens.owner);
    const res = await postWebhook(
      app,
      id,
      fakeInboundBody({ messageId: 'm1', customerId: 'cust-1', text: 'Hi there' }),
    );
    expect(res.status).toBe(200);
    expect(res.body.data.processed).toBe(1);

    const customer = await prisma.customer.findFirst({
      where: { companyId: acme.company.id, externalId: 'cust-1' },
    });
    expect(customer).not.toBeNull();
    const conv = await prisma.conversation.findFirst({
      where: { companyId: acme.company.id, customerId: customer!.id },
    });
    expect(conv?.channelAccountId).toBe(id);
    expect(conv?.providerKey).toBe('fake');
    expect(conv?.unreadCount).toBe(1);
    const msg = await prisma.message.findFirst({
      where: { conversationId: conv!.id },
    });
    expect(msg?.direction).toBe('INBOUND');
    expect(msg?.status).toBe('RECEIVED');
    const activity = await prisma.conversationActivity.findFirst({
      where: { conversationId: conv!.id, activityType: 'MESSAGE_RECEIVED' },
    });
    expect(activity).not.toBeNull();
    // A webhook event was recorded and processed.
    const event = await prisma.channelWebhookEvent.findFirst({
      where: { channelAccountId: id },
    });
    expect(event?.status).toBe('PROCESSED');
  });

  it('reuses the customer/conversation on a second message', async () => {
    const id = await fakeAccountId(acme.tokens.owner);
    await postWebhook(app, id, fakeInboundBody({ messageId: 'm1', customerId: 'c' }));
    await postWebhook(app, id, fakeInboundBody({ messageId: 'm2', customerId: 'c' }));
    const convs = await prisma.conversation.count({
      where: { companyId: acme.company.id },
    });
    expect(convs).toBe(1);
    const conv = await prisma.conversation.findFirst({
      where: { companyId: acme.company.id },
    });
    expect(conv?.unreadCount).toBe(2);
  });

  it('is idempotent: a duplicate event does not duplicate the message', async () => {
    const id = await fakeAccountId(acme.tokens.owner);
    const body = fakeInboundBody({ messageId: 'dup', eventId: 'evt-dup' });
    const first = await postWebhook(app, id, body);
    expect(first.body.data.processed).toBe(1);
    const second = await postWebhook(app, id, body);
    expect(second.body.data.duplicates).toBe(1);
    expect(second.body.data.processed).toBe(0);

    const count = await prisma.message.count({ where: { companyId: acme.company.id } });
    expect(count).toBe(1);
  });

  it('duplicate inbound does not generate a second AI reply', async () => {
    setAIProviderForTesting(makeFakeProvider({ text: 'AI reply.' }).provider);
    await prisma.companyAISettings.upsert({
      where: { companyId: acme.company.id },
      create: { companyId: acme.company.id, autoReplyEnabled: true },
      update: { autoReplyEnabled: true },
    });
    const id = await fakeAccountId(acme.tokens.owner);
    const body = fakeInboundBody({ messageId: 'dup', eventId: 'evt-dup' });
    await postWebhook(app, id, body);
    await postWebhook(app, id, body);
    // 1 inbound + 1 AI reply, no duplicates.
    const count = await prisma.message.count({ where: { companyId: acme.company.id } });
    expect(count).toBe(2);
  });

  it('isolates tenants: same external ids in different companies do not collide', async () => {
    const acmeId = await fakeAccountId(acme.tokens.owner);
    const globexId = await fakeAccountId(globex.tokens.owner);
    const body = fakeInboundBody({ messageId: 'same', eventId: 'same-evt', customerId: 'same' });
    const a = await postWebhook(app, acmeId, body);
    const g = await postWebhook(app, globexId, body);
    expect(a.body.data.processed).toBe(1);
    expect(g.body.data.processed).toBe(1);
    expect(await prisma.conversation.count({ where: { companyId: acme.company.id } })).toBe(1);
    expect(await prisma.conversation.count({ where: { companyId: globex.company.id } })).toBe(1);
  });

  it('ignores an unsupported event and records it', async () => {
    const id = await fakeAccountId(acme.tokens.owner);
    const res = await postWebhook(app, id, {
      event: 'reaction',
      eventId: 'evt-x',
      messageId: 'm',
    });
    expect(res.body.data.ignored).toBe(1);
    expect(await prisma.message.count({ where: { companyId: acme.company.id } })).toBe(0);
    const event = await prisma.channelWebhookEvent.findFirst({ where: { channelAccountId: id } });
    expect(event?.status).toBe('IGNORED');
  });

  it('fails safely on an invalid normalized payload (empty content)', async () => {
    const id = await fakeAccountId(acme.tokens.owner);
    const res = await postWebhook(app, id, {
      event: 'message',
      eventId: 'evt-empty',
      messageId: 'm-empty',
      text: '   ', // truthy for the parser, but empty after normalization
      customer: { id: 'c-empty' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.failed).toBe(1);
    // No message persisted; existing records uncorrupted.
    expect(await prisma.message.count({ where: { companyId: acme.company.id } })).toBe(0);
    const event = await prisma.channelWebhookEvent.findFirst({ where: { channelAccountId: id } });
    expect(event?.status).toBe('FAILED');
  });
});
