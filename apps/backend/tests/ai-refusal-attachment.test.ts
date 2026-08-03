import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';
import { prisma } from './setup';
import { setAIProviderForTesting } from '../src/modules/ai';
import { makeFakeProvider } from './ai-helpers';
import { aiPromptService } from '../src/modules/ai/ai-prompt.service';
import { buildDefaultSettings } from '../src/modules/ai-settings/ai-settings.types';

/**
 * A refusal never carries a photo.
 *
 * Seen in a live Messenger thread: the customer asked "I need image", the
 * assistant replied "Let me connect you with a member of our team." — and an
 * unrelated product photo was attached to it.
 *
 * The handoff sentinel did not catch this because the model never emitted it.
 * Both the handoff and fallback strings are handed to the model inside the
 * prompt, so it also writes them as ordinary prose. The reply then looked like
 * a normal answer that happened to name no item, which is precisely the trigger
 * for "customer asked for a photo, guess one".
 */

const app = createApp();
const HANDOFF = 'Let me connect you with a member of our team.';
const FALLBACK = "Sorry, I couldn't understand that. Could you rephrase?";

let acme: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  await prisma.companyAISettings.create({
    data: {
      companyId: acme.company.id,
      autoReplyEnabled: true,
      welcomeEnabled: false,
      humanHandoffMessage: HANDOFF,
      fallbackMessage: FALLBACK,
      // Off: otherwise "I need image" can trip the handoff path instead of the
      // prose path this test is about.
      handoffOnRequest: false,
      handoffOnLowConfidence: false,
    },
  });
  await prisma.businessService.create({
    data: {
      companyId: acme.company.id,
      name: 'Standard Consultation',
      price: '25',
      currency: 'JOD',
      imageUrl: 'https://img.test/consultation.png',
    },
  });
});
afterEach(() => setAIProviderForTesting(null));

let seq = 0;
async function askForPhoto(replyText: string) {
  setAIProviderForTesting(makeFakeProvider({ text: replyText }).provider);
  seq += 1;
  const res = await request(app)
    .post('/api/v1/dev/mock-inbound-message')
    .set(authHeader(acme.tokens.owner))
    .send({
      channelType: 'MANUAL',
      externalCustomerId: `cust-${seq}`,
      customer: { fullName: 'Test Customer' },
      message: { externalMessageId: `m${seq}`, content: 'I need image' },
    });
  expect(res.status).toBe(201);
  return prisma.message.findFirst({
    where: { conversationId: res.body.data.conversation.id, senderType: 'AI' },
    select: { content: true, mediaUrl: true, contentType: true },
  });
}

describe('a refusal reply carries no attachment', () => {
  it('does not attach a photo to the handoff message (production repro)', async () => {
    const ai = await askForPhoto(HANDOFF);
    expect(ai?.content).toBe(HANDOFF);
    expect(ai?.mediaUrl).toBeNull();
    expect(ai?.contentType).toBe('TEXT');
  });

  it('does not attach a photo to the fallback message', async () => {
    const ai = await askForPhoto(FALLBACK);
    expect(ai?.mediaUrl).toBeNull();
  });

  it('still refuses to attach when the model adds its own line', async () => {
    // The model routinely appends a sentence, so equality would not catch it.
    const ai = await askForPhoto(`${HANDOFF} They will reply shortly.`);
    expect(ai?.mediaUrl).toBeNull();
  });

  it('still attaches for a genuine answer that names an item', async () => {
    // The guard must not cost real photos — this is the behaviour it protects.
    const ai = await askForPhoto('Here is the Standard Consultation.');
    expect(ai?.mediaUrl).toBe('https://img.test/consultation.png');
  });

  it('still guesses a photo when a real answer names nothing matchable', async () => {
    // The original purpose of the guess: a short affirmative reply to an
    // explicit photo request.
    const ai = await askForPhoto('Of course, here you go!');
    expect(ai?.mediaUrl).toBe('https://img.test/consultation.png');
  });
});

describe('position references point at the list already sent', () => {
  it('is spelled out in the prompt', () => {
    // Observed: after a five-item list, "details for the first service" was
    // answered about the third.
    const p = aiPromptService.buildSystemPrompt({
      companyName: 'Acme',
      contextText: 'Services: A – 1 JOD.',
      settings: buildDefaultSettings('c1'),
      injectionSuspected: false,
    });
    expect(p).toMatch(/POSITION REFERENCES/);
    expect(p).toMatch(/the list exactly as YOU last sent it/i);
    expect(p).toMatch(/counted top to bottom/i);
    // Arabic customers phrase it the same way and must be covered.
    expect(p).toContain('الأول');
    expect(p).toMatch(/if no list was sent, ask which item they mean/i);
  });
});
