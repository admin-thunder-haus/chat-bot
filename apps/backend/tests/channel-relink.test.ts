import request from 'supertest';
import { createApp } from '../src/app';
import {
  setupTenant,
  authHeader,
  makeCustomer,
  makeConversation,
  type Tenant,
} from './helpers';
import { prisma } from './setup';
import { createFakeChannel, fakeInboundBody, postWebhook } from './channel-helpers';

/**
 * Regression suite for orphaned conversations. Hard-deleting a channel account
 * nulls `Conversation.channelAccountId` (`onDelete: SetNull`), so every existing
 * conversation loses its provider link. Inbound keeps working (the webhook URL
 * carries the account), but outbound used to fall back SILENTLY to the local
 * persist path: the agent saw "sent" and nothing ever reached the platform.
 */

const app = createApp();
let acme: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
});

/** Create a fake-channel conversation via an inbound webhook. */
async function fakeChannelConversation(customerId = 'cust-relink') {
  const created = await createFakeChannel(app, acme.tokens.owner);
  const accountId = created.body.data.account.id as string;
  await postWebhook(
    app,
    accountId,
    fakeInboundBody({ messageId: 'in-1', customerId }),
  );
  const conversation = await prisma.conversation.findFirstOrThrow({
    where: { companyId: acme.company.id, channelAccountId: accountId },
  });
  return { accountId, conversationId: conversation.id };
}

/** Simulate the reconnect fallout: the account link is gone, providerKey stays. */
async function orphan(conversationId: string) {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { channelAccountId: null },
  });
}

function sendMessage(convId: string, token: string, content: string) {
  return request(app)
    .post(`/api/v1/conversations/${convId}/messages`)
    .set(authHeader(token))
    .send({ content });
}

describe('Channel re-linking after a disconnect/reconnect', () => {
  it('inbound re-links a conversation whose channelAccountId is NULL', async () => {
    const { accountId, conversationId } = await fakeChannelConversation();
    await orphan(conversationId);

    await postWebhook(
      app,
      accountId,
      fakeInboundBody({ messageId: 'in-2', customerId: 'cust-relink' }),
    );

    const conv = await prisma.conversation.findFirstOrThrow({
      where: { id: conversationId },
    });
    expect(conv.channelAccountId).toBe(accountId);
    expect(conv.providerKey).toBe('fake');
    // The inbound message still landed on the SAME conversation.
    expect(
      await prisma.message.count({
        where: { conversationId, direction: 'INBOUND' },
      }),
    ).toBe(2);
  });

  it('manual send on an orphaned conversation dispatches through the provider and persists the link', async () => {
    const { accountId, conversationId } = await fakeChannelConversation();
    await orphan(conversationId);

    const res = await sendMessage(conversationId, acme.tokens.agent, 'Reply after reconnect');

    expect(res.status).toBe(201);
    expect(res.body.data.message.status).toBe('SENT');
    // Proof the fake provider transport actually handled the send.
    expect(res.body.data.message.externalMessageId).toMatch(/^fake-out-/);

    const delivery = await prisma.channelDelivery.findFirst({
      where: { messageId: res.body.data.message.id },
    });
    expect(delivery?.status).toBe('SENT');
    expect(delivery?.channelAccountId).toBe(accountId);

    // Self-healed: the link is persisted for every later send.
    const conv = await prisma.conversation.findFirstOrThrow({
      where: { id: conversationId },
    });
    expect(conv.channelAccountId).toBe(accountId);
    expect(conv.providerKey).toBe('fake');
  });

  it('refuses a push-channel send with no connected account (400 CHANNEL_NOT_CONNECTED, no message)', async () => {
    const customer = await makeCustomer(acme.company.id, {
      channelType: 'FACEBOOK',
      externalId: 'psid-1',
    });
    const conv = await makeConversation(acme.company.id, customer.id, {
      channelType: 'FACEBOOK',
      providerKey: 'facebook',
    });

    const res = await sendMessage(conv.id, acme.tokens.owner, 'Never fake-send this');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CHANNEL_NOT_CONNECTED');
    expect(await prisma.message.count({ where: { conversationId: conv.id } })).toBe(0);
    expect(
      await prisma.channelDelivery.count({ where: { companyId: acme.company.id } }),
    ).toBe(0);
  });

  it('webchat conversations still use the local path (no delivery row, message SENT)', async () => {
    const customer = await makeCustomer(acme.company.id, {
      channelType: 'WEBCHAT',
      externalId: 'visitor-1',
    });
    const conv = await makeConversation(acme.company.id, customer.id, {
      channelType: 'WEBCHAT',
    });

    const res = await sendMessage(conv.id, acme.tokens.agent, 'Local webchat reply');

    expect(res.status).toBe(201);
    expect(res.body.data.message.status).toBe('SENT');
    expect(
      await prisma.channelDelivery.count({ where: { companyId: acme.company.id } }),
    ).toBe(0);
  });
});
