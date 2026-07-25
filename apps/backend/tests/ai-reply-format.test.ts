import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';
import { prisma } from './setup';
import { setAIProviderForTesting } from '../src/modules/ai';
import { makeFakeProvider } from './ai-helpers';
import { stripSpeakerPrefix } from '../src/modules/ai/ai-prompt.service';

/**
 * The provider text is labelled history ("Customer: …" / "AI: …"), so the model
 * imitates the pattern and emits "AI: <reply>". Production evidence: customers
 * received messages literally starting with "AI: ". The reply must be cleaned
 * before it is persisted, sent, or inspected for sentinels.
 */

const app = createApp();
let acme: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  await prisma.companyAISettings.upsert({
    where: { companyId: acme.company.id },
    create: { companyId: acme.company.id, autoReplyEnabled: true },
    update: { autoReplyEnabled: true },
  });
});
afterEach(() => setAIProviderForTesting(null));

function mockInbound(content: string) {
  return request(app)
    .post('/api/v1/dev/mock-inbound-message')
    .set(authHeader(acme.tokens.owner))
    .send({
      channelType: 'MANUAL',
      externalCustomerId: 'cust-fmt',
      customer: { fullName: 'Format Tester' },
      message: { externalMessageId: `m-${Date.now()}-${Math.random()}`, content },
    });
}

function aiMessage(conversationId: string) {
  return prisma.message.findFirst({
    where: { conversationId, senderType: 'AI' },
  });
}

describe('stripSpeakerPrefix', () => {
  it('removes a single leading speaker label', () => {
    expect(stripSpeakerPrefix('AI: Hello there')).toBe('Hello there');
    expect(stripSpeakerPrefix('  assistant :  Hello')).toBe('Hello');
    expect(stripSpeakerPrefix('Agent: Hi')).toBe('Hi');
    expect(stripSpeakerPrefix('Bot: Hi')).toBe('Hi');
    expect(stripSpeakerPrefix('Customer: Hi')).toBe('Hi');
  });

  it('removes the Arabic labels and the full-width colon', () => {
    expect(stripSpeakerPrefix('مساعد: مرحبا')).toBe('مرحبا');
    expect(stripSpeakerPrefix('الذكاء الاصطناعي: مرحبا')).toBe('مرحبا');
    expect(stripSpeakerPrefix('AI：مرحبا')).toBe('مرحبا');
  });

  it('never touches a label that appears mid-message', () => {
    const text = 'Sure! AI Chatbot Setup: 300 JOD includes training.';
    expect(stripSpeakerPrefix(text)).toBe(text);
  });

  it('leaves an unlabelled reply and a colon-free start alone', () => {
    expect(stripSpeakerPrefix('Hello there')).toBe('Hello there');
    expect(stripSpeakerPrefix('AI Chatbot Setup costs 300 JOD')).toBe(
      'AI Chatbot Setup costs 300 JOD',
    );
  });

  it('strips only ONE leading occurrence', () => {
    expect(stripSpeakerPrefix('AI: Customer: hi')).toBe('Customer: hi');
  });

  it('keeps the original text when stripping would empty it', () => {
    expect(stripSpeakerPrefix('AI:')).toBe('AI:');
  });
});

describe('AI replies never carry the speaker label or markdown', () => {
  it('persists "Hello there" for a provider reply of "AI: Hello there"', async () => {
    setAIProviderForTesting(
      makeFakeProvider({ text: 'AI: Hello there' }).provider,
    );
    const res = await mockInbound('hi');
    expect(res.body.data.autoReply.generated).toBe(true);
    const msg = await aiMessage(res.body.data.conversation.id);
    expect(msg?.content).toBe('Hello there');
  });

  it('keeps an item name containing a colon intact mid-reply', async () => {
    setAIProviderForTesting(
      makeFakeProvider({
        text: 'Sure! AI Chatbot Setup: 300 JOD includes training.',
      }).provider,
    );
    const res = await mockInbound('how much is the chatbot setup?');
    const msg = await aiMessage(res.body.data.conversation.id);
    expect(msg?.content).toBe(
      'Sure! AI Chatbot Setup: 300 JOD includes training.',
    );
  });

  it('normalizes markdown out of the outbound message', async () => {
    setAIProviderForTesting(
      makeFakeProvider({
        text: 'AI: ### Products\n- *CRM Pro License*: **120 JOD** — yearly',
      }).provider,
    );
    const res = await mockInbound('what do you sell?');
    const msg = await aiMessage(res.body.data.conversation.id);
    expect(msg?.content).toBe('Products\n• CRM Pro License: 120 JOD — yearly');
  });

  it('exposes the cleaned text through the draft endpoint too', async () => {
    setAIProviderForTesting(
      makeFakeProvider({ text: 'Assistant: **Sure**, happy to help.' }).provider,
    );
    const inbound = await mockInbound('question?');
    const convId = inbound.body.data.conversation.id;
    const draft = await request(app)
      .post(`/api/v1/conversations/${convId}/ai/draft`)
      .set(authHeader(acme.tokens.owner))
      .send({});
    expect(draft.status).toBe(200);
    expect(draft.body.data.text).toBe('Sure, happy to help.');
  });
});
