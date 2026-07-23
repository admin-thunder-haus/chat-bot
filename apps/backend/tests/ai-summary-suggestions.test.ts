import request from 'supertest';
import { createApp } from '../src/app';
import { authHeader, setupTenant, makeCustomer, makeConversation, type Tenant } from './helpers';
import { prisma } from './setup';
import { setAIProviderForTesting } from '../src/modules/ai';
import { makeFakeProvider } from './ai-helpers';
import { AIError } from '../src/modules/ai/ai.errors';

/**
 * Day 11: conversation summaries (auto on resolve/close + on demand) and
 * agent-facing AI reply suggestions.
 */

const app = createApp();
let acme: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
});
afterEach(() => {
  setAIProviderForTesting(null);
});

async function conversationWithMessages(): Promise<string> {
  const customer = await makeCustomer(acme.company.id, { fullName: 'Sami' });
  const conversation = await makeConversation(acme.company.id, customer.id);
  await prisma.message.createMany({
    data: [
      {
        companyId: acme.company.id,
        conversationId: conversation.id,
        customerId: customer.id,
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        content: 'My POS terminal stopped printing receipts.',
        status: 'RECEIVED',
      },
      {
        companyId: acme.company.id,
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        senderType: 'AGENT',
        senderUserId: acme.users.owner.id,
        content: 'Please restart it and check the paper roll.',
        status: 'SENT',
      },
    ],
  });
  return conversation.id;
}

describe('conversation summary', () => {
  it('is generated automatically when a conversation is resolved', async () => {
    const convId = await conversationWithMessages();
    setAIProviderForTesting(
      makeFakeProvider({
        text: 'Issue: printer problem. Outcome: resolved after restart.',
      }).provider,
    );

    const res = await request(app)
      .patch(`/api/v1/conversations/${convId}/status`)
      .set(authHeader(acme.tokens.owner))
      .send({ status: 'RESOLVED' });

    expect(res.status).toBe(200);
    expect(res.body.data.conversation.aiSummary).toContain('printer problem');
    expect(res.body.data.conversation.aiSummaryGeneratedAt).toBeTruthy();

    const gen = await prisma.aIResponseGeneration.findFirst({
      where: { companyId: acme.company.id, generationType: 'SUMMARY' },
    });
    expect(gen?.status).toBe('COMPLETED');
    expect(gen?.conversationId).toBe(convId);
  });

  it('summary failure never blocks the status change', async () => {
    const convId = await conversationWithMessages();
    setAIProviderForTesting(
      makeFakeProvider({ throwError: AIError.unavailable() }).provider,
    );

    const res = await request(app)
      .patch(`/api/v1/conversations/${convId}/status`)
      .set(authHeader(acme.tokens.owner))
      .send({ status: 'CLOSED' });

    expect(res.status).toBe(200);
    expect(res.body.data.conversation.status).toBe('CLOSED');
    expect(res.body.data.conversation.aiSummary).toBeNull();
  });

  it('can be generated on demand', async () => {
    const convId = await conversationWithMessages();
    setAIProviderForTesting(
      makeFakeProvider({ text: 'Issue: receipts. Outcome: pending.' }).provider,
    );

    const res = await request(app)
      .post(`/api/v1/conversations/${convId}/summary`)
      .set(authHeader(acme.tokens.owner))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.summary).toContain('receipts');

    const conv = await prisma.conversation.findFirst({ where: { id: convId } });
    expect(conv?.aiSummary).toContain('receipts');
  });

  it('rejects summarizing an empty conversation', async () => {
    const customer = await makeCustomer(acme.company.id, {});
    const conversation = await makeConversation(acme.company.id, customer.id);
    setAIProviderForTesting(makeFakeProvider({ text: 'x' }).provider);

    const res = await request(app)
      .post(`/api/v1/conversations/${conversation.id}/summary`)
      .set(authHeader(acme.tokens.owner))
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('AI reply suggestions', () => {
  it('returns multiple suggestions without creating messages', async () => {
    const convId = await conversationWithMessages();
    setAIProviderForTesting(
      makeFakeProvider({
        text: 'Try turning it off and on again.\n###\nI can arrange a technician visit.',
      }).provider,
    );

    const before = await prisma.message.count({
      where: { conversationId: convId },
    });

    const res = await request(app)
      .post(`/api/v1/conversations/${convId}/ai/suggestions`)
      .set(authHeader(acme.tokens.agent))
      .send({ count: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data.suggestions).toEqual([
      'Try turning it off and on again.',
      'I can arrange a technician visit.',
    ]);

    const after = await prisma.message.count({
      where: { conversationId: convId },
    });
    expect(after).toBe(before);

    const gen = await prisma.aIResponseGeneration.findFirst({
      where: { companyId: acme.company.id, generationType: 'SUGGESTION' },
    });
    expect(gen?.status).toBe('COMPLETED');
  });

  it('falls back to a single suggestion when the model ignores the delimiter', async () => {
    const convId = await conversationWithMessages();
    setAIProviderForTesting(
      makeFakeProvider({ text: 'Just one combined answer.' }).provider,
    );

    const res = await request(app)
      .post(`/api/v1/conversations/${convId}/ai/suggestions`)
      .set(authHeader(acme.tokens.owner))
      .send({ count: 3 });

    expect(res.status).toBe(200);
    expect(res.body.data.suggestions).toEqual(['Just one combined answer.']);
  });

  it('validates the count bounds', async () => {
    const convId = await conversationWithMessages();
    const res = await request(app)
      .post(`/api/v1/conversations/${convId}/ai/suggestions`)
      .set(authHeader(acme.tokens.owner))
      .send({ count: 7 });
    expect(res.status).toBe(400);
  });
});
