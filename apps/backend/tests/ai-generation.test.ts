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
import { setAIProviderForTesting } from '../src/modules/ai';
import { utcDay } from '../src/modules/ai/ai.repository';
import { AIError } from '../src/modules/ai/ai.errors';
import { makeFakeProvider, type FakeProviderHandle } from './ai-helpers';

const app = createApp();
let acme: Tenant;
let globex: Tenant;
let fake: FakeProviderHandle;

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
  fake = makeFakeProvider({ text: 'How can I help you today?' });
  setAIProviderForTesting(fake.provider);
});

afterEach(() => setAIProviderForTesting(null));

async function convWithInbound(content = 'What are your prices?') {
  const customer = await makeCustomer(acme.company.id);
  const conv = await makeConversation(acme.company.id, customer.id);
  await prisma.message.create({
    data: {
      companyId: acme.company.id,
      conversationId: conv.id,
      customerId: customer.id,
      direction: 'INBOUND',
      senderType: 'CUSTOMER',
      content,
      status: 'RECEIVED',
      sentAt: new Date(),
    },
  });
  return conv;
}

describe('AI draft generation', () => {
  it('OWNER, ADMIN and AGENT can all generate a draft', async () => {
    const conv = await convWithInbound();
    for (const token of [acme.tokens.owner, acme.tokens.admin, acme.tokens.agent]) {
      const res = await request(app)
        .post(`/api/v1/conversations/${conv.id}/ai/draft`)
        .set(authHeader(token))
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.data.text).toBe('How can I help you today?');
      expect(res.body.data.generationId).toEqual(expect.any(String));
    }
  });

  it('does NOT create a customer-visible message', async () => {
    const conv = await convWithInbound();
    await request(app)
      .post(`/api/v1/conversations/${conv.id}/ai/draft`)
      .set(authHeader(acme.tokens.owner))
      .send({});
    const count = await prisma.message.count({
      where: { conversationId: conv.id },
    });
    expect(count).toBe(1); // only the original inbound
  });

  it('records a COMPLETED generation with token counts and usage', async () => {
    const conv = await convWithInbound();
    await request(app)
      .post(`/api/v1/conversations/${conv.id}/ai/draft`)
      .set(authHeader(acme.tokens.owner))
      .send({});
    const gen = await prisma.aIResponseGeneration.findFirst({
      where: { companyId: acme.company.id, conversationId: conv.id },
    });
    expect(gen?.status).toBe('COMPLETED');
    expect(gen?.generationType).toBe('DRAFT');
    expect(gen?.totalTokenCount).toBe(20);

    const usage = await prisma.aIUsageDaily.findUnique({
      where: { companyId_date: { companyId: acme.company.id, date: utcDay() } },
    });
    expect(usage?.requestCount).toBe(1);
    expect(usage?.totalTokenCount).toBe(20);
  });

  it('rejects unauthenticated requests', async () => {
    const conv = await convWithInbound();
    const res = await request(app)
      .post(`/api/v1/conversations/${conv.id}/ai/draft`)
      .send({});
    expect(res.status).toBe(401);
  });

  it('returns 404 for another tenant’s conversation', async () => {
    const conv = await convWithInbound();
    const res = await request(app)
      .post(`/api/v1/conversations/${conv.id}/ai/draft`)
      .set(authHeader(globex.tokens.owner))
      .send({});
    expect(res.status).toBe(404);
  });

  it('handles a conversation with no inbound message', async () => {
    const customer = await makeCustomer(acme.company.id);
    const conv = await makeConversation(acme.company.id, customer.id);
    const res = await request(app)
      .post(`/api/v1/conversations/${conv.id}/ai/draft`)
      .set(authHeader(acme.tokens.owner))
      .send({});
    expect(res.status).toBe(400);
  });

  it('records a FAILED generation on provider failure', async () => {
    setAIProviderForTesting(
      makeFakeProvider({ throwError: AIError.unavailable() }).provider,
    );
    const conv = await convWithInbound();
    const res = await request(app)
      .post(`/api/v1/conversations/${conv.id}/ai/draft`)
      .set(authHeader(acme.tokens.owner))
      .send({});
    expect(res.status).toBe(503);
    const gen = await prisma.aIResponseGeneration.findFirst({
      where: { companyId: acme.company.id, conversationId: conv.id },
    });
    expect(gen?.status).toBe('FAILED');
    expect(gen?.failureCode).toBe('AI_UNAVAILABLE');
  });

  it('blocks provider calls when the quota is exceeded', async () => {
    await prisma.aIUsageDaily.create({
      data: { companyId: acme.company.id, date: utcDay(), requestCount: 1000 },
    });
    const conv = await convWithInbound();
    const res = await request(app)
      .post(`/api/v1/conversations/${conv.id}/ai/draft`)
      .set(authHeader(acme.tokens.owner))
      .send({});
    expect(res.status).toBe(429);
    expect(fake.calls.length).toBe(0); // provider never called
  });
});

describe('Direct AI reply', () => {
  it('OWNER can send a direct AI reply (OUTBOUND + AI message)', async () => {
    const conv = await convWithInbound();
    const res = await request(app)
      .post(`/api/v1/conversations/${conv.id}/ai/reply`)
      .set(authHeader(acme.tokens.owner))
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.data.message.direction).toBe('OUTBOUND');
    expect(res.body.data.message.senderType).toBe('AI');

    const gen = await prisma.aIResponseGeneration.findFirst({
      where: { companyId: acme.company.id, conversationId: conv.id },
    });
    expect(gen?.generatedMessageId).toBe(res.body.data.message.id);

    const activity = await prisma.conversationActivity.findFirst({
      where: { conversationId: conv.id, activityType: 'MESSAGE_SENT' },
    });
    expect(activity).not.toBeNull();
  });

  it('forbids AGENT from sending a direct AI reply', async () => {
    const conv = await convWithInbound();
    const res = await request(app)
      .post(`/api/v1/conversations/${conv.id}/ai/reply`)
      .set(authHeader(acme.tokens.agent))
      .send({});
    expect(res.status).toBe(403);
  });
});

describe('AI usage accounting', () => {
  it('aggregates per company and updates the same date', async () => {
    const conv = await convWithInbound();
    await request(app)
      .post(`/api/v1/conversations/${conv.id}/ai/draft`)
      .set(authHeader(acme.tokens.owner))
      .send({});
    await request(app)
      .post(`/api/v1/conversations/${conv.id}/ai/draft`)
      .set(authHeader(acme.tokens.owner))
      .send({});
    const usage = await prisma.aIUsageDaily.findMany({
      where: { companyId: acme.company.id },
    });
    expect(usage.length).toBe(1); // same date -> one row
    expect(usage[0].requestCount).toBe(2);
    expect(Number(usage[0].estimatedCostUsd)).toBeGreaterThan(0);
  });

  it('keeps usage tenant-scoped via GET /ai/usage', async () => {
    const conv = await convWithInbound();
    await request(app)
      .post(`/api/v1/conversations/${conv.id}/ai/draft`)
      .set(authHeader(acme.tokens.owner))
      .send({});
    const res = await request(app)
      .get('/api/v1/ai/usage')
      .set(authHeader(globex.tokens.owner));
    expect(res.status).toBe(200);
    expect(res.body.data.today.requestCount).toBe(0); // globex has none
  });
});
