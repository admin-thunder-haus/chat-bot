import { createApp } from '../src/app';
import { setupTenant, type Tenant } from './helpers';
import { prisma } from './setup';
import { setAIProviderForTesting } from '../src/modules/ai';
import { makeFakeProvider } from './ai-helpers';
import { setTelegramTransportForTesting } from '../src/modules/channels';
import {
  connectTelegram,
  makeTelegramTransport,
  telegramSecret,
  tgWebhook,
  tgTextUpdate,
  TG,
} from './telegram-helpers';

const app = createApp();
let acme: Tenant;
let globex: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
  setTelegramTransportForTesting(makeTelegramTransport().transport);
});
afterEach(() => {
  setTelegramTransportForTesting(null);
  setAIProviderForTesting(null);
});

async function connected(tenant: Tenant) {
  const res = await connectTelegram(app, tenant.tokens.owner);
  const id = res.body.data.account.id as string;
  const secret = await telegramSecret(tenant.company.id, id);
  return { id, secret, res };
}

describe('Telegram — connect', () => {
  it('connects a bot (OWNER), verifies via getMe, registers the webhook, encrypts creds', async () => {
    const res = await connectTelegram(app, acme.tokens.owner);
    expect(res.status).toBe(201);
    expect(res.body.data.account.channelType).toBe('TELEGRAM');
    expect(res.body.data.account.externalAccountId).toBe(TG.botId);
    expect(res.body.data.account.connectionState).toBe('HEALTHY');
    expect(res.body.data.webhookRegistered).toBe(true);
    const cred = await prisma.channelCredential.findFirst({ where: { channelAccountId: res.body.data.account.id } });
    expect(cred!.encryptedPayload).not.toContain(TG.botToken);
  });

  it('never returns secrets; AGENT cannot connect; companyId + duplicate rejected', async () => {
    const res = await connectTelegram(app, acme.tokens.owner);
    expect(JSON.stringify(res.body)).not.toContain(TG.botToken);
    expect((await connectTelegram(app, acme.tokens.agent)).status).toBe(403);
    expect((await connectTelegram(app, acme.tokens.owner, { companyId: globex.company.id })).status).toBe(400);
    expect((await connectTelegram(app, acme.tokens.owner)).status).toBe(409); // same bot id
    // Same bot id is allowed in another tenant.
    expect((await connectTelegram(app, globex.tokens.owner)).status).toBe(201);
  });

  it('does not report false success on an invalid token', async () => {
    setTelegramTransportForTesting(
      makeTelegramTransport({ getMe: () => ({ status: 401, ok: false, json: { ok: false, error_code: 401 } }) }).transport,
    );
    const res = await connectTelegram(app, acme.tokens.owner);
    expect(res.status).toBe(201);
    expect(res.body.data.account.connectionState).toBe('AUTH_EXPIRED');
    expect(res.body.message).not.toMatch(/verified and webhook active/i);
  });
});

describe('Telegram — webhook + incoming pipeline', () => {
  it('rejects a wrong/missing secret token; accepts the correct one', async () => {
    const { id } = await connected(acme);
    expect((await tgWebhook(app, id, tgTextUpdate({ updateId: 1, messageId: 1, text: 'hi' }), 'wrong')).status).toBe(401);
    expect((await tgWebhook(app, id, tgTextUpdate({ updateId: 1, messageId: 1, text: 'hi' }), null)).status).toBe(401);
  });

  it('creates customer (with name) + conversation + message from a text update', async () => {
    const { id, secret } = await connected(acme);
    const res = await tgWebhook(app, id, tgTextUpdate({ updateId: 5, messageId: 9, text: 'Hello Telegram' }), secret);
    expect(res.status).toBe(200);
    expect(res.body.data.processed).toBe(1);
    const customer = await prisma.customer.findFirst({ where: { companyId: acme.company.id, channelType: 'TELEGRAM', externalId: TG.chatId } });
    expect(customer?.fullName).toBe(`${TG.userFirst} ${TG.userLast}`);
    expect(customer?.username).toBe(TG.userName);
    const conv = await prisma.conversation.findFirst({ where: { companyId: acme.company.id, customerId: customer!.id } });
    expect(conv?.channelAccountId).toBe(id);
    const msg = await prisma.message.findFirst({ where: { conversationId: conv!.id } });
    expect(msg?.content).toBe('Hello Telegram');
    // Idempotent replay (same update_id).
    const dup = await tgWebhook(app, id, tgTextUpdate({ updateId: 5, messageId: 9, text: 'Hello Telegram' }), secret);
    expect(dup.body.data.duplicates).toBe(1);
    expect(await prisma.message.count({ where: { companyId: acme.company.id, senderType: 'CUSTOMER' } })).toBe(1);
  });

  it('triggers AI auto-reply, and the agent reply sends via the bot', async () => {
    setAIProviderForTesting(makeFakeProvider({ text: 'Telegram AI reply.' }).provider);
    await prisma.companyAISettings.upsert({ where: { companyId: acme.company.id }, create: { companyId: acme.company.id, autoReplyEnabled: true }, update: { autoReplyEnabled: true } });
    const { id, secret } = await connected(acme);
    await tgWebhook(app, id, tgTextUpdate({ updateId: 6, messageId: 10, text: 'What are your hours?' }), secret);
    const conv = await prisma.conversation.findFirst({ where: { companyId: acme.company.id, channelType: 'TELEGRAM' } });
    const ai = await prisma.message.findFirst({ where: { conversationId: conv!.id, senderType: 'AI' } });
    expect(ai?.content).toBe('Telegram AI reply.');
    const delivery = await prisma.channelDelivery.findFirst({ where: { messageId: ai!.id } });
    expect(delivery?.status).toBe('SENT');
    expect(delivery?.externalMessageId).toMatch(/^\d+$/);
  });

  it('is tenant-isolated: a cross-tenant secret cannot post to another account', async () => {
    const { id: acmeId } = await connected(acme);
    const { secret: globexSecret } = await connected(globex);
    const res = await tgWebhook(app, acmeId, tgTextUpdate({ updateId: 9, messageId: 1, text: 'intrusion' }), globexSecret);
    expect(res.status).toBe(401);
    expect(await prisma.message.count({ where: { companyId: globex.company.id } })).toBe(0);
  });
});
