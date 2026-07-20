import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';
import { prisma } from './setup';
import { setAIProviderForTesting } from '../src/modules/ai';
import { AIError } from '../src/modules/ai/ai.errors';
import { makeFakeProvider } from './ai-helpers';

const app = createApp();
let acme: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  setAIProviderForTesting(makeFakeProvider({ text: 'Auto AI reply.' }).provider);
});
afterEach(() => setAIProviderForTesting(null));

function mockInbound(
  extMsgId: string,
  content = 'Hi, what are your prices?',
  extCust = 'cust-1',
) {
  return request(app)
    .post('/api/v1/dev/mock-inbound-message')
    .set(authHeader(acme.tokens.owner))
    .send({
      channelType: 'MANUAL',
      externalCustomerId: extCust,
      customer: { fullName: 'Test Customer' },
      message: { externalMessageId: extMsgId, content },
    });
}

async function enableAutoReply() {
  await prisma.companyAISettings.upsert({
    where: { companyId: acme.company.id },
    create: { companyId: acme.company.id, autoReplyEnabled: true },
    update: { autoReplyEnabled: true },
  });
}

function messageCount(conversationId: string) {
  return prisma.message.count({ where: { conversationId } });
}

describe('AI auto-reply for mock inbound', () => {
  it('does not auto-reply when the company setting is disabled', async () => {
    const res = await mockInbound('m1');
    expect(res.body.data.autoReply.generated).toBe(false);
    expect(await messageCount(res.body.data.conversation.id)).toBe(1);
  });

  it('creates exactly one AI outbound message when enabled', async () => {
    await enableAutoReply();
    const res = await mockInbound('m1');
    expect(res.body.data.autoReply.generated).toBe(true);
    const convId = res.body.data.conversation.id;
    expect(await messageCount(convId)).toBe(2);
    const ai = await prisma.message.findFirst({
      where: { conversationId: convId, senderType: 'AI' },
    });
    expect(ai?.direction).toBe('OUTBOUND');
  });

  it('is idempotent for a duplicate inbound (no duplicate inbound or AI reply)', async () => {
    await enableAutoReply();
    const first = await mockInbound('dup');
    const convId = first.body.data.conversation.id;
    const dup = await mockInbound('dup');
    expect(dup.body.data.idempotent).toBe(true);
    expect(await messageCount(convId)).toBe(2); // still 1 inbound + 1 AI
  });

  it('preserves the inbound message when the provider fails', async () => {
    await enableAutoReply();
    setAIProviderForTesting(
      makeFakeProvider({ throwError: AIError.unavailable() }).provider,
    );
    const res = await mockInbound('m1');
    expect(res.body.data.autoReply.generated).toBe(false);
    expect(await messageCount(res.body.data.conversation.id)).toBe(1);
  });

  it('does not auto-reply when AI is paused', async () => {
    await enableAutoReply();
    const first = await mockInbound('m1');
    const convId = first.body.data.conversation.id;
    await request(app)
      .patch(`/api/v1/conversations/${convId}/ai-mode`)
      .set(authHeader(acme.tokens.owner))
      .send({ mode: 'PAUSED' });
    const second = await mockInbound('m2');
    expect(second.body.data.autoReply.generated).toBe(false);
    expect(second.body.data.autoReply.reason).toBe('ai_paused');
  });

  it('pauses AI and skips auto-reply on a human-handoff request', async () => {
    await enableAutoReply();
    const res = await mockInbound('m1', 'I want to speak to a human please');
    expect(res.body.data.autoReply.generated).toBe(false);
    expect(res.body.data.autoReply.reason).toBe('handoff_requested');
    const conv = await prisma.conversation.findFirst({
      where: { id: res.body.data.conversation.id },
    });
    expect(conv?.aiMode).toBe('PAUSED');
    expect(conv?.handoffRequestedAt).not.toBeNull();
  });
});
