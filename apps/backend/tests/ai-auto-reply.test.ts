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

  // The global env flag is a KILL SWITCH, not the opt-in: it defaults to
  // enabled so an operator who cannot edit Render env vars still gets replies,
  // while the per-company toggle (default false) remains the real opt-in.
  describe('AI_AUTO_REPLY_ENABLED is a kill switch, read lazily', () => {
    const original = process.env.AI_AUTO_REPLY_ENABLED;
    afterEach(() => {
      if (original === undefined) delete process.env.AI_AUTO_REPLY_ENABLED;
      else process.env.AI_AUTO_REPLY_ENABLED = original;
    });

    it('auto-replies with the env var UNSET when the company opted in', async () => {
      delete process.env.AI_AUTO_REPLY_ENABLED;
      await enableAutoReply();
      const res = await mockInbound('m-unset');
      expect(res.body.data.autoReply.generated).toBe(true);
      expect(await messageCount(res.body.data.conversation.id)).toBe(2);
    });

    it('still requires the per-company opt-in when the env var is unset', async () => {
      delete process.env.AI_AUTO_REPLY_ENABLED;
      const res = await mockInbound('m-unset-nocompany');
      expect(res.body.data.autoReply.generated).toBe(false);
      expect(res.body.data.autoReply.reason).toBe('auto_reply_disabled_company');
    });

    it('does not auto-reply when the env var is explicitly false', async () => {
      process.env.AI_AUTO_REPLY_ENABLED = 'false';
      await enableAutoReply();
      const res = await mockInbound('m-off');
      expect(res.body.data.autoReply.generated).toBe(false);
      expect(res.body.data.autoReply.reason).toBe('auto_reply_disabled_env');
      expect(await messageCount(res.body.data.conversation.id)).toBe(1);
    });
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
