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

const app = createApp();
let acme: Tenant;
let globex: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
});

/** Create a fake-channel conversation (via an inbound webhook) and return ids. */
async function fakeChannelConversation() {
  const created = await createFakeChannel(app, acme.tokens.owner);
  const accountId = created.body.data.account.id;
  await postWebhook(
    app,
    accountId,
    fakeInboundBody({ messageId: 'in-1', customerId: 'cust-out' }),
  );
  const conv = await prisma.conversation.findFirst({
    where: { companyId: acme.company.id, channelAccountId: accountId },
  });
  return { accountId, conversationId: conv!.id };
}

function sendMessage(convId: string, token: string, content: string) {
  return request(app)
    .post(`/api/v1/conversations/${convId}/messages`)
    .set(authHeader(token))
    .send({ content });
}

describe('Outgoing message pipeline', () => {
  it('sends through the fake provider and records a SENT delivery', async () => {
    const { conversationId } = await fakeChannelConversation();
    const res = await sendMessage(conversationId, acme.tokens.agent, 'Reply via fake');
    expect(res.status).toBe(201);
    expect(res.body.data.message.direction).toBe('OUTBOUND');
    expect(res.body.data.message.status).toBe('SENT');
    expect(res.body.data.message.externalMessageId).toMatch(/^fake-out-/);

    const delivery = await prisma.channelDelivery.findFirst({
      where: { messageId: res.body.data.message.id },
    });
    expect(delivery?.status).toBe('SENT');
    expect(delivery?.externalMessageId).toBe(res.body.data.message.externalMessageId);

    const activity = await prisma.channelActivity.findFirst({
      where: { companyId: acme.company.id, activityType: 'CHANNEL_MESSAGE_SENT' },
    });
    expect(activity).not.toBeNull();
  });

  it('records a failure safely when the provider send fails', async () => {
    const { conversationId } = await fakeChannelConversation();
    const res = await sendMessage(conversationId, acme.tokens.owner, 'boom __FAIL__');
    expect(res.status).toBe(201);
    expect(res.body.data.message.status).toBe('FAILED');

    const delivery = await prisma.channelDelivery.findFirst({
      where: { messageId: res.body.data.message.id },
    });
    expect(delivery?.status).toBe('FAILED');
    const activity = await prisma.channelActivity.findFirst({
      where: { companyId: acme.company.id, activityType: 'CHANNEL_MESSAGE_FAILED' },
    });
    expect(activity).not.toBeNull();
  });

  it('manual/legacy conversation still sends locally (no delivery row)', async () => {
    const customer = await makeCustomer(acme.company.id);
    const conv = await makeConversation(acme.company.id, customer.id);
    const res = await sendMessage(conv.id, acme.tokens.agent, 'Local send');
    expect(res.status).toBe(201);
    expect(res.body.data.message.status).toBe('SENT');
    const deliveries = await prisma.channelDelivery.count({
      where: { companyId: acme.company.id },
    });
    expect(deliveries).toBe(0);
  });

  it('another tenant cannot send through the channel account (404)', async () => {
    const { conversationId } = await fakeChannelConversation();
    const res = await sendMessage(conversationId, globex.tokens.owner, 'intrusion');
    expect(res.status).toBe(404);
  });

  it('internal notes are never dispatched to the provider', async () => {
    const { conversationId } = await fakeChannelConversation();
    const note = await request(app)
      .post(`/api/v1/conversations/${conversationId}/notes`)
      .set(authHeader(acme.tokens.owner))
      .send({ content: 'Private note — do not send' });
    expect([200, 201]).toContain(note.status);
    // No delivery created by an internal note.
    const deliveries = await prisma.channelDelivery.count({
      where: { companyId: acme.company.id },
    });
    expect(deliveries).toBe(0);
  });
});
