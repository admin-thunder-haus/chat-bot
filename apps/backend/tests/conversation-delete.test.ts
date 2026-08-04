import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';
import { prisma } from './setup';

/**
 * Permanently deleting a conversation.
 *
 * Archiving hides a thread and keeps it; this destroys it. Two consequences are
 * the point of the feature rather than side effects: the customer record
 * survives (so their other conversations on other channels are untouched), and
 * because inbound looks for an UNARCHIVED conversation for that customer, their
 * next message opens a genuinely new one and is greeted as a first contact.
 */

const app = createApp();
let acme: Tenant;
let globex: Tenant;

async function seedConversation(tenant: Tenant) {
  const customer = await prisma.customer.create({
    data: {
      companyId: tenant.company.id,
      channelType: 'MANUAL',
      externalId: `ext-${tenant.company.id}`,
      fullName: 'Ahmad',
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      companyId: tenant.company.id,
      customerId: customer.id,
      channelType: 'MANUAL',
      status: 'OPEN',
    },
  });
  await prisma.message.create({
    data: {
      companyId: tenant.company.id,
      conversationId: conversation.id,
      customerId: customer.id,
      direction: 'INBOUND',
      senderType: 'CUSTOMER',
      content: 'hello',
    },
  });
  return { customer, conversation };
}

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
});

function del(id: string, token: string) {
  return request(app)
    .delete(`/api/v1/conversations/${id}`)
    .set(authHeader(token));
}

describe('DELETE /conversations/:id', () => {
  it('removes the conversation and its messages', async () => {
    const { conversation } = await seedConversation(acme);
    const res = await del(conversation.id, acme.tokens.owner);
    expect(res.status).toBe(200);

    expect(
      await prisma.conversation.count({ where: { id: conversation.id } }),
    ).toBe(0);
    expect(
      await prisma.message.count({ where: { conversationId: conversation.id } }),
    ).toBe(0);
  });

  it('keeps the customer, so their other threads survive', async () => {
    // Deleting the person because one of their conversations was deleted would
    // silently take their history on every other channel with it.
    const { customer, conversation } = await seedConversation(acme);
    await del(conversation.id, acme.tokens.owner);
    expect(await prisma.customer.count({ where: { id: customer.id } })).toBe(1);
  });

  it('lets the same customer start a genuinely new conversation', async () => {
    // This is what makes the greeting fire again, which is why the feature was
    // asked for in the first place.
    const { customer, conversation } = await seedConversation(acme);
    await del(conversation.id, acme.tokens.owner);

    const next = await prisma.conversation.findFirst({
      where: {
        companyId: acme.company.id,
        customerId: customer.id,
        channelType: 'MANUAL',
        isArchived: false,
      },
    });
    expect(next).toBeNull();
  });

  it('keeps the AI spend audit, with the conversation link cleared', async () => {
    const { conversation } = await seedConversation(acme);
    const gen = await prisma.aIResponseGeneration.create({
      data: {
        companyId: acme.company.id,
        conversationId: conversation.id,
        generationType: 'AUTO_REPLY',
        status: 'COMPLETED',
        provider: 'fake',
        model: 'fake',
        promptVersion: 'v3-2026-08',
      },
    });

    await del(conversation.id, acme.tokens.owner);

    const after = await prisma.aIResponseGeneration.findUnique({
      where: { id: gen.id },
    });
    expect(after).not.toBeNull();
    expect(after!.conversationId).toBeNull();
  });

  it('is refused for AGENT — they may archive, not destroy', async () => {
    const { conversation } = await seedConversation(acme);
    expect((await del(conversation.id, acme.tokens.agent)).status).toBe(403);
    expect(
      await prisma.conversation.count({ where: { id: conversation.id } }),
    ).toBe(1);
  });

  it('is refused without authentication', async () => {
    const { conversation } = await seedConversation(acme);
    const res = await request(app).delete(
      `/api/v1/conversations/${conversation.id}`,
    );
    expect(res.status).toBe(401);
  });

  it('cannot reach another tenant\'s conversation', async () => {
    const other = await seedConversation(globex);
    const res = await del(other.conversation.id, acme.tokens.owner);
    expect(res.status).toBe(404);
    expect(
      await prisma.conversation.count({ where: { id: other.conversation.id } }),
    ).toBe(1);
  });

  it('answers 404 for an id that does not exist', async () => {
    const res = await del('11111111-1111-4111-8111-111111111111', acme.tokens.owner);
    expect(res.status).toBe(404);
  });

  it('does not shadow the nested message routes', async () => {
    // `DELETE /:id` is declared alongside `/:id/messages`; a greedy match here
    // would take out the sub-resources.
    const { conversation } = await seedConversation(acme);
    const res = await request(app)
      .get(`/api/v1/conversations/${conversation.id}/messages`)
      .set(authHeader(acme.tokens.owner));
    expect(res.status).toBe(200);
  });
});
