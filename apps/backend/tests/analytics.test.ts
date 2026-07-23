import request from 'supertest';
import { createApp } from '../src/app';
import { authHeader, setupTenant, makeCustomer, makeConversation, type Tenant } from './helpers';
import { prisma } from './setup';

/** Day 11 AI analytics endpoint: aggregation + tenant isolation. */

const app = createApp();
let acme: Tenant;
let globex: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
});

async function seedData(): Promise<void> {
  const customer = await makeCustomer(acme.company.id, {});

  // 3 conversations: one resolved, one handed off, one open Arabic webchat.
  const resolved = await makeConversation(acme.company.id, customer.id, {
    status: 'RESOLVED',
    resolvedAt: new Date(),
  });
  await makeConversation(acme.company.id, customer.id, {
    handoffRequestedAt: new Date(),
    handoffReason: 'customer_request',
    aiMode: 'PAUSED',
  });
  await makeConversation(acme.company.id, customer.id, {
    channelType: 'WEBCHAT',
    detectedLanguage: 'ar',
  });

  const faq = await prisma.frequentlyAskedQuestion.create({
    data: {
      companyId: acme.company.id,
      question: 'What are your working hours?',
      answer: '9 to 5',
    },
  });
  const service = await prisma.businessService.create({
    data: {
      companyId: acme.company.id,
      name: 'Premium Plan',
      priceType: 'CONTACT_US',
    },
  });

  // Two completed generations + one failed.
  const summaryBase = {
    companyProfile: true,
    businessHoursIncluded: false,
    serviceIds: [service.id],
    productIds: [],
    faqIds: [faq.id],
    knowledgeIds: [],
    documentIds: [],
    historyMessageCount: 0,
    approxCharacters: 100,
    injectionSuspected: false,
  };
  await prisma.aIResponseGeneration.createMany({
    data: [
      {
        companyId: acme.company.id,
        conversationId: resolved.id,
        generationType: 'AUTO_REPLY',
        status: 'COMPLETED',
        provider: 'fake',
        model: 'test',
        promptVersion: 'v-test',
        contextSummary: summaryBase,
      },
      {
        companyId: acme.company.id,
        generationType: 'DRAFT',
        status: 'COMPLETED',
        provider: 'fake',
        model: 'test',
        promptVersion: 'v-test',
        contextSummary: summaryBase,
      },
      {
        companyId: acme.company.id,
        generationType: 'AUTO_REPLY',
        status: 'FAILED',
        provider: 'fake',
        model: 'test',
        promptVersion: 'v-test',
      },
    ],
  });
}

describe('GET /api/v1/analytics/ai', () => {
  it('aggregates volume, handoff, generations, and top entities', async () => {
    await seedData();

    const res = await request(app)
      .get('/api/v1/analytics/ai?days=30')
      .set(authHeader(acme.tokens.agent));

    expect(res.status).toBe(200);
    const data = res.body.data;

    expect(data.rangeDays).toBe(30);
    expect(data.conversationVolume.total).toBe(3);
    expect(data.conversationVolume.byDay.length).toBeGreaterThan(0);
    expect(
      data.conversationVolume.byChannel.find(
        (c: { channelType: string }) => c.channelType === 'WEBCHAT',
      )?.count,
    ).toBe(1);

    expect(data.resolution.resolvedInRange).toBe(1);
    expect(data.resolution.avgResolutionHours).not.toBeNull();

    expect(data.handoff.total).toBe(1);
    expect(data.handoff.rate).toBeCloseTo(1 / 3);
    expect(data.handoff.byReason).toEqual([
      { reason: 'customer_request', count: 1 },
    ]);

    expect(data.aiGenerations.total).toBe(3);
    expect(data.aiGenerations.completed).toBe(2);
    expect(data.aiGenerations.failed).toBe(1);
    expect(data.aiGenerations.successRate).toBeCloseTo(2 / 3);

    expect(data.topFaqs[0].question).toBe('What are your working hours?');
    expect(data.topFaqs[0].count).toBe(2);
    expect(data.topServices[0].name).toBe('Premium Plan');

    expect(data.languages).toEqual([{ code: 'ar', count: 1 }]);
  });

  it('is tenant-isolated and validates the range', async () => {
    await seedData();

    const other = await request(app)
      .get('/api/v1/analytics/ai')
      .set(authHeader(globex.tokens.owner));
    expect(other.status).toBe(200);
    expect(other.body.data.conversationVolume.total).toBe(0);
    expect(other.body.data.aiGenerations.total).toBe(0);

    const bad = await request(app)
      .get('/api/v1/analytics/ai?days=500')
      .set(authHeader(acme.tokens.owner));
    expect(bad.status).toBe(400);

    const unauth = await request(app).get('/api/v1/analytics/ai');
    expect(unauth.status).toBe(401);
  });
});
