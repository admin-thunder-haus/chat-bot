import request from 'supertest';
import { createApp } from '../src/app';
import { authHeader, setupTenant, type Tenant } from './helpers';
import { prisma } from './setup';
import { setAIProviderForTesting } from '../src/modules/ai';
import { makeFakeProvider } from './ai-helpers';
import { detectHandoffRequest } from '../src/modules/ai/ai.service';

/**
 * Day 11 human handoff: explicit customer requests (multilingual + custom
 * keywords), low-confidence sentinel handoff, config gates, and return-to-AI.
 */

const app = createApp();
let acme: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
});
afterEach(() => {
  setAIProviderForTesting(null);
});

async function enableAutoReply(
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await prisma.companyAISettings.upsert({
    where: { companyId: acme.company.id },
    create: { companyId: acme.company.id, autoReplyEnabled: true, ...overrides },
    update: { autoReplyEnabled: true, ...overrides },
  });
}

function mockInbound(content: string, extId = `cust-${Date.now()}`) {
  return request(app)
    .post('/api/v1/dev/mock-inbound-message')
    .set(authHeader(acme.tokens.owner))
    .send({
      channelType: 'MANUAL',
      externalCustomerId: extId,
      customer: { fullName: 'Handoff Tester' },
      message: { externalMessageId: `m-${Math.random()}`, content },
    });
}

describe('detectHandoffRequest', () => {
  it('matches English requests', () => {
    expect(detectHandoffRequest('I want to speak to a human please')).toBe(true);
  });
  it('matches Arabic requests', () => {
    expect(detectHandoffRequest('بدي احكي مع موظف')).toBe(true);
    expect(detectHandoffRequest('حولني على خدمة العملاء')).toBe(true);
  });
  it('matches company-specific keywords', () => {
    expect(detectHandoffRequest('give me the boss', ['the boss'])).toBe(true);
  });
  it('ignores ordinary questions', () => {
    expect(detectHandoffRequest('what are your opening hours?')).toBe(false);
    expect(detectHandoffRequest('شو أسعار الخدمات؟')).toBe(false);
  });
});

describe('explicit customer handoff (auto-reply path)', () => {
  it('pauses AI, records the handoff, and sends the handoff notice', async () => {
    await enableAutoReply();
    setAIProviderForTesting(makeFakeProvider({ text: 'should not be used' }).provider);

    const res = await mockInbound('بدي احكي مع موظف حقيقي');
    expect(res.body.data.autoReply.generated).toBe(false);
    expect(res.body.data.autoReply.reason).toBe('handoff_requested');

    const conv = await prisma.conversation.findFirst({
      where: { id: res.body.data.conversation.id },
    });
    expect(conv?.aiMode).toBe('PAUSED');
    expect(conv?.handoffRequestedAt).not.toBeNull();
    expect(conv?.handoffReason).toBe('customer_request');

    // The customer received the configured handoff message as a SYSTEM reply.
    const notice = await prisma.message.findFirst({
      where: {
        conversationId: conv!.id,
        direction: 'OUTBOUND',
        senderType: 'SYSTEM',
      },
    });
    expect(notice?.content).toBe(
      'Let me connect you with a member of our team.',
    );
  });

  it('respects custom handoff keywords from settings', async () => {
    await enableAutoReply({ handoffKeywords: ['مسؤول المبيعات'] });
    setAIProviderForTesting(makeFakeProvider({ text: 'normal reply' }).provider);

    const res = await mockInbound('ممكن مسؤول المبيعات يتواصل معي');
    expect(res.body.data.autoReply.reason).toBe('handoff_requested');
  });

  it('does not hand off when handoffOnRequest is disabled', async () => {
    await enableAutoReply({ handoffOnRequest: false });
    setAIProviderForTesting(makeFakeProvider({ text: 'AI answered anyway' }).provider);

    const res = await mockInbound('I want to talk to a human');
    expect(res.body.data.autoReply.generated).toBe(true);

    const conv = await prisma.conversation.findFirst({
      where: { id: res.body.data.conversation.id },
    });
    expect(conv?.aiMode).toBe('ENABLED');
  });
});

describe('low-confidence handoff (sentinel)', () => {
  it('replaces the sentinel with the handoff message and pauses AI', async () => {
    await enableAutoReply();
    const fake = makeFakeProvider({ text: 'HANDOFF_REQUIRED' });
    setAIProviderForTesting(fake.provider);

    const res = await mockInbound('what is the meaning of quantum life?');
    expect(res.body.data.autoReply.generated).toBe(true);

    const conv = await prisma.conversation.findFirst({
      where: { id: res.body.data.conversation.id },
    });
    expect(conv?.aiMode).toBe('PAUSED');
    expect(conv?.handoffReason).toBe('low_confidence');

    const aiMessage = await prisma.message.findFirst({
      where: { conversationId: conv!.id, senderType: 'AI' },
    });
    // Customers never see the raw sentinel.
    expect(aiMessage?.content).toBe(
      'Let me connect you with a member of our team.',
    );

    // The prompt explicitly allowed the sentinel.
    expect(fake.lastInput()?.systemPrompt).toContain('HANDOFF_REQUIRED');
  });

  it('does not offer the sentinel when handoffOnLowConfidence is off', async () => {
    await enableAutoReply({ handoffOnLowConfidence: false });
    const fake = makeFakeProvider({ text: 'a normal answer' });
    setAIProviderForTesting(fake.provider);

    await mockInbound('anything at all');
    expect(fake.lastInput()?.systemPrompt).not.toContain('HANDOFF_REQUIRED');
  });

  it('AI stays silent on follow-up messages after handoff', async () => {
    await enableAutoReply();
    setAIProviderForTesting(makeFakeProvider({ text: 'HANDOFF_REQUIRED' }).provider);

    const first = await mockInbound('impossible question', 'cust-stay');
    const convId = first.body.data.conversation.id as string;

    setAIProviderForTesting(makeFakeProvider({ text: 'should not appear' }).provider);
    const second = await mockInbound('hello again?', 'cust-stay');
    expect(second.body.data.autoReply.generated).toBe(false);
    expect(second.body.data.autoReply.reason).toBe('ai_paused');

    const aiMessages = await prisma.message.count({
      where: { conversationId: convId, senderType: 'AI' },
    });
    expect(aiMessages).toBe(1);
  });
});

describe('return to AI', () => {
  it('re-enabling AI clears the handoff flags', async () => {
    await enableAutoReply();
    setAIProviderForTesting(makeFakeProvider({ text: 'HANDOFF_REQUIRED' }).provider);

    const res = await mockInbound('cannot answer this');
    const convId = res.body.data.conversation.id as string;

    const resume = await request(app)
      .patch(`/api/v1/conversations/${convId}/ai-mode`)
      .set(authHeader(acme.tokens.owner))
      .send({ mode: 'ENABLED' });
    expect(resume.status).toBe(200);

    const conv = await prisma.conversation.findFirst({ where: { id: convId } });
    expect(conv?.aiMode).toBe('ENABLED');
    expect(conv?.handoffRequestedAt).toBeNull();
    expect(conv?.handoffReason).toBeNull();
  });
});

describe('automatic language detection', () => {
  it('stores the detected language on conversation and customer', async () => {
    await enableAutoReply();
    const fake = makeFakeProvider({ text: 'أهلاً بك' });
    setAIProviderForTesting(fake.provider);

    const res = await mockInbound('مرحبا، شو الأسعار عندكم؟');
    const convId = res.body.data.conversation.id as string;

    const conv = await prisma.conversation.findFirst({ where: { id: convId } });
    expect(conv?.detectedLanguage).toBe('ar');

    const customer = await prisma.customer.findFirst({
      where: { id: conv!.customerId },
    });
    expect(customer?.preferredLanguage).toBe('ar');

    // The system prompt carries the detected-language hint.
    expect(fake.lastInput()?.systemPrompt).toContain('Arabic');
  });

  it('follows the most recent message in mixed-language conversations', async () => {
    await enableAutoReply();
    setAIProviderForTesting(makeFakeProvider({ text: 'ok' }).provider);

    await mockInbound('مرحبا كيف الحال معكم اليوم', 'cust-mixed');
    await mockInbound('Actually, can you answer me in English please, what are the prices?', 'cust-mixed');

    const conv = await prisma.conversation.findFirst({
      where: { companyId: acme.company.id },
      orderBy: { lastMessageAt: 'desc' },
    });
    expect(conv?.detectedLanguage).toBe('en');
  });
});
