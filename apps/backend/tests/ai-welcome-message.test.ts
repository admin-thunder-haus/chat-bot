import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';
import { drainJobs } from './jobs-helpers';
import { prisma } from './setup';
import { setAIProviderForTesting } from '../src/modules/ai';
import { makeFakeProvider } from './ai-helpers';
import {
  buildWelcomeMessage,
  PLATFORM_BRAND,
  PLATFORM_URL,
} from '../src/modules/ai/welcome-message';
import { aiPromptService } from '../src/modules/ai/ai-prompt.service';
import { buildDefaultSettings } from '../src/modules/ai-settings/ai-settings.types';

/**
 * The greeting a customer gets on first contact.
 *
 * Two properties carry the weight. It is sent ONCE per conversation — a
 * greeting repeated on every message is the clearest possible signal that
 * nobody is really there. And it carries the BUSINESS's name, not the
 * platform's: the customer messaged a barber shop, and being welcomed to
 * something they have never heard of reads as a wrong number.
 */

const app = createApp();
let acme: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  setAIProviderForTesting(makeFakeProvider({ text: 'Sure, we open at 10.' }).provider);
  await prisma.companyAISettings.create({
    data: { companyId: acme.company.id, autoReplyEnabled: true },
  });
});
afterEach(() => setAIProviderForTesting(null));

let msgSeq = 0;
function inbound(text: string, extCust = 'cust-1') {
  msgSeq += 1;
  return request(app)
    .post('/api/v1/dev/mock-inbound-message')
    .set(authHeader(acme.tokens.owner))
    .send({
      channelType: 'MANUAL',
      externalCustomerId: extCust,
      customer: { fullName: 'Test Customer' },
      message: { externalMessageId: `m${msgSeq}`, content: text },
    });
}

async function messagesOf(conversationId: string) {
  return prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: { senderType: true, content: true },
  });
}

describe('buildWelcomeMessage', () => {
  const base = { companyName: 'Acme Barbers', preferredLanguage: 'auto' };

  it('greets in Arabic when the customer wrote Arabic', () => {
    const msg = buildWelcomeMessage({ ...base, customerMessage: 'مرحبا' });
    expect(msg).toContain('أهلاً وسهلاً بك في Acme Barbers');
    expect(msg).toContain(`مدعوم بواسطة ${PLATFORM_BRAND}`);
  });

  it('greets in English when the customer wrote English', () => {
    const msg = buildWelcomeMessage({ ...base, customerMessage: 'hello there' });
    expect(msg).toContain('Welcome to Acme Barbers');
    expect(msg).toContain(`Powered by ${PLATFORM_BRAND}`);
  });

  it('honours an explicit language preference over what was written', () => {
    expect(
      buildWelcomeMessage({ ...base, preferredLanguage: 'ar', customerMessage: 'hi' }),
    ).toContain('أهلاً وسهلاً');
    expect(
      buildWelcomeMessage({ ...base, preferredLanguage: 'en', customerMessage: 'مرحبا' }),
    ).toContain('Welcome to');
  });

  it('links to the platform in both languages', () => {
    for (const msg of ['hello', 'مرحبا']) {
      expect(buildWelcomeMessage({ ...base, customerMessage: msg })).toContain(
        PLATFORM_URL,
      );
    }
  });

  it('writes the link bare, not as markdown', () => {
    // These channels render text verbatim: `[Thunder.AI](https://…)` would
    // arrive with the brackets showing, while a plain URL auto-links.
    const msg = buildWelcomeMessage({ ...base, customerMessage: 'hello' });
    expect(msg).not.toMatch(/\]\(https?:/);
    expect(msg).not.toMatch(/<a\s/i);
  });

  it('carries the business name, never the platform name, as the greeting', () => {
    const msg = buildWelcomeMessage({ ...base, customerMessage: 'hi' });
    // The platform appears once, in the attribution line — not in the welcome.
    expect(msg.split('\n')[0]).toContain('Acme Barbers');
    expect(msg.split('\n')[0]).not.toContain(PLATFORM_BRAND);
  });

  it('uses a company\'s own wording when it has set one', () => {
    const msg = buildWelcomeMessage({
      ...base,
      customerMessage: 'hi',
      customMessage: 'Yo! Welcome to the shop.',
    });
    expect(msg).toContain('Yo! Welcome to the shop.');
    expect(msg).not.toContain('Welcome to Acme Barbers');
  });

  it('keeps the attribution even on a custom message', () => {
    // Otherwise every company removes it within a week by writing their own.
    expect(
      buildWelcomeMessage({ ...base, customerMessage: 'hi', customMessage: 'Hey.' }),
    ).toContain(PLATFORM_BRAND);
  });

  it('does not duplicate the attribution when the custom text already has it', () => {
    const msg = buildWelcomeMessage({
      ...base,
      customerMessage: 'hi',
      customMessage: `Hey. Powered by ${PLATFORM_BRAND}`,
    });
    expect(msg.match(new RegExp(PLATFORM_BRAND, 'g'))).toHaveLength(1);
  });

  it('falls back to English for a language it has no greeting for', () => {
    // Better a correct English greeting than a machine-translated one.
    expect(
      buildWelcomeMessage({ ...base, customerMessage: 'bonjour ça va' }),
    ).toContain('Welcome to');
  });

  it('treats blank custom text as "use the built-in one"', () => {
    expect(
      buildWelcomeMessage({ ...base, customerMessage: 'hi', customMessage: '   ' }),
    ).toContain('Welcome to Acme Barbers');
  });
});

describe('the greeting in a real conversation', () => {
  it('is sent once, before the AI reply, on first contact', async () => {
    const res = await inbound('what time do you open?');
    expect(res.status).toBe(201);
    await drainJobs();

    const msgs = await messagesOf(res.body.data.conversation.id);
    // customer message, greeting, then the answer — in that order.
    expect(msgs.map((m) => m.senderType)).toEqual(['CUSTOMER', 'SYSTEM', 'AI']);
    expect(msgs[1].content).toContain(PLATFORM_BRAND);
    expect(msgs[2].content).toBe('Sure, we open at 10.');
  });

  it('is NOT repeated on the customer\'s next message', async () => {
    const first = await inbound('hello');
    await drainJobs();
    await inbound('and where are you?');
    await drainJobs();

    const msgs = await messagesOf(first.body.data.conversation.id);
    expect(msgs.filter((m) => m.senderType === 'SYSTEM')).toHaveLength(1);
  });

  it('is skipped entirely when the company turns it off', async () => {
    await prisma.companyAISettings.update({
      where: { companyId: acme.company.id },
      data: { welcomeEnabled: false },
    });

    const res = await inbound('hello');
    await drainJobs();

    const msgs = await messagesOf(res.body.data.conversation.id);
    expect(msgs.map((m) => m.senderType)).toEqual(['CUSTOMER', 'AI']);
  });

  it('still answers when the greeting cannot be built', async () => {
    // The greeting is a courtesy; the answer is the product. A customer who
    // gets no hello is mildly worse off, one who gets nothing was ignored.
    await prisma.company.update({
      where: { id: acme.company.id },
      data: { displayName: null },
    });

    const res = await inbound('hello');
    await drainJobs();
    const msgs = await messagesOf(res.body.data.conversation.id);
    expect(msgs.some((m) => m.senderType === 'AI')).toBe(true);
  });
});

describe('the greeting is configurable through the API', () => {
  it('round-trips welcomeEnabled and welcomeMessage', async () => {
    const put = await request(app)
      .put('/api/v1/ai-settings')
      .set(authHeader(acme.tokens.owner))
      .send({ welcomeEnabled: false, welcomeMessage: 'Hi from us!' });
    expect(put.status).toBe(200);
    expect(put.body.data.settings.welcomeEnabled).toBe(false);
    expect(put.body.data.settings.welcomeMessage).toBe('Hi from us!');
  });

  it('clearing the text restores the built-in greeting rather than sending nothing', async () => {
    await request(app)
      .put('/api/v1/ai-settings')
      .set(authHeader(acme.tokens.owner))
      .send({ welcomeMessage: 'Custom' });
    const cleared = await request(app)
      .put('/api/v1/ai-settings')
      .set(authHeader(acme.tokens.owner))
      .send({ welcomeMessage: '' });
    expect(cleared.body.data.settings.welcomeMessage).toBeNull();
  });

  it('defaults to on for a company that never configured it', async () => {
    const globex = await setupTenant('globex');
    const res = await request(app)
      .get('/api/v1/ai-settings')
      .set(authHeader(globex.tokens.owner));
    expect(res.body.data.settings.welcomeEnabled).toBe(true);
    expect(res.body.data.settings.welcomeMessage).toBeNull();
  });
});

describe('the reply does not greet again right under the greeting', () => {
  it('tells the model a welcome was just sent', () => {
    // Observed live: greeting went out, then "Hi there! How can I assist you
    // today? 😊" — the customer's first contact was two hellos and no content.
    const p = aiPromptService.buildSystemPrompt({
      companyName: 'Acme',
      contextText: 'Services: A – 1 JOD.',
      settings: buildDefaultSettings('c1'),
      injectionSuspected: false,
      justGreeted: true,
    });
    expect(p).toMatch(/ALREADY GREETED/);
    expect(p).toMatch(/Do not greet them again/i);
    expect(p).toMatch(/do not ask "how can I help"/i);
  });

  it('says nothing about greeting when none was sent', () => {
    const p = aiPromptService.buildSystemPrompt({
      companyName: 'Acme',
      contextText: 'Services: A – 1 JOD.',
      settings: buildDefaultSettings('c1'),
      injectionSuspected: false,
    });
    expect(p).not.toMatch(/ALREADY GREETED/);
  });
});
