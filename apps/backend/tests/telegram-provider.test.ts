import {
  TelegramChannelProvider,
  setTelegramTransportForTesting,
  classifyTelegram,
} from '../src/modules/channels';
import { TG, makeTelegramTransport, tgTextUpdate } from './telegram-helpers';

const provider = new TelegramChannelProvider();
const creds = { botToken: TG.botToken, secretToken: 'the-secret' };

afterEach(() => setTelegramTransportForTesting(null));

describe('Telegram provider — registration & capabilities', () => {
  it('is a real, credentialed TELEGRAM provider', () => {
    expect(provider.key).toBe('telegram');
    expect(provider.channelType).toBe('TELEGRAM');
    expect(provider.requiresCredentials).toBe(true);
    expect(provider.developmentOnly).toBe(false);
  });
  it('advertises text; no HMAC verify handshake, no delivery/read receipts', () => {
    const c = provider.capabilities;
    expect(c.textMessages).toBe(true);
    expect(c.inboundMessaging).toBe(true);
    expect(c.outboundMessaging).toBe(true);
    expect(c.webhookSignatures).toBe(true);
    expect(c.webhookVerification).toBe(false);
    expect(c.deliveryReceipts).toBe(false);
    expect(c.readReceipts).toBe(false);
  });
});

describe('Telegram provider — connection preparation', () => {
  it('parses the bot id and stores token + secret', () => {
    const prep = provider.prepareConnection({
      displayName: 'TG',
      payload: { botToken: TG.botToken, secretToken: 's' },
    });
    expect(prep.externalAccountId).toBe(TG.botId);
    expect(prep.secretCredentials).toMatchObject({ botToken: TG.botToken, secretToken: 's' });
    expect(JSON.stringify(prep.metadata)).not.toContain(TG.botToken);
  });
  it('rejects an invalid token or missing secret', () => {
    expect(() => provider.prepareConnection({ displayName: 'TG', payload: { botToken: 'nope', secretToken: 's' } })).toThrow(/Validation failed/);
    expect(() => provider.prepareConnection({ displayName: 'TG', payload: { botToken: TG.botToken } })).toThrow(/Validation failed/);
  });
});

describe('Telegram provider — webhook auth (secret token header)', () => {
  it('has no GET challenge (always unverified)', async () => {
    expect((await provider.verifyWebhookChallenge({ query: {}, headers: {}, credentials: creds })).verified).toBe(false);
  });
  it('accepts the matching secret token; rejects wrong/missing/creds-less', async () => {
    const raw = Buffer.from('{}');
    expect(await provider.validateWebhookSignature({ rawBody: raw, headers: { 'x-telegram-bot-api-secret-token': 'the-secret' }, credentials: creds })).toBe(true);
    expect(await provider.validateWebhookSignature({ rawBody: raw, headers: { 'x-telegram-bot-api-secret-token': 'wrong' }, credentials: creds })).toBe(false);
    expect(await provider.validateWebhookSignature({ rawBody: raw, headers: {}, credentials: creds })).toBe(false);
    expect(await provider.validateWebhookSignature({ rawBody: raw, headers: { 'x-telegram-bot-api-secret-token': 'the-secret' }, credentials: null })).toBe(false);
  });
});

describe('Telegram provider — parsing', () => {
  const parse = (body: unknown) => provider.parseWebhook({ channelType: 'TELEGRAM', body, headers: {}, credentials: creds });

  it('normalizes a text message with the sender name + username', async () => {
    const events = await parse(tgTextUpdate({ updateId: 10, messageId: 1, text: 'hello bot' }));
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.kind).toBe('incoming_message');
    if (e.kind === 'incoming_message') {
      expect(e.content).toBe('hello bot');
      expect(e.externalMessageId).toBe('1');
      expect(e.customer.externalCustomerId).toBe(TG.chatId);
      expect(e.customer.fullName).toBe(`${TG.userFirst} ${TG.userLast}`);
      expect(e.customer.username).toBe(TG.userName);
    }
  });
  it('records media / edited / callback / empty safely', async () => {
    const media = { update_id: 2, message: { message_id: 3, chat: { id: 1 }, photo: [{}] } };
    expect((await parse(media))[0].kind).toBe('unsupported');
    expect((await parse({ update_id: 3, edited_message: { message_id: 4, chat: { id: 1 } } }))[0].kind).toBe('unsupported');
    expect((await parse({ update_id: 4, callback_query: { id: 'x' } }))[0].kind).toBe('unsupported');
    expect(await parse({})).toEqual([]);
    expect(await parse(null)).toEqual([]);
  });
});

describe('Telegram provider — send / health', () => {
  const base = { channelType: 'TELEGRAM' as const, externalCustomerId: TG.chatId, text: 'hi', credentials: creds };
  it('sends text and returns the message id', async () => {
    const { transport, calls } = makeTelegramTransport();
    setTelegramTransportForTesting(transport);
    const res = await provider.sendMessage(base);
    expect(res.status).toBe('sent');
    expect(res.externalMessageId).toMatch(/^\d+$/);
    expect(calls.some((c) => c.url.includes('/sendMessage'))).toBe(true);
  });
  it('classifies 401 auth (permanent) and 429 (retryable)', async () => {
    setTelegramTransportForTesting(makeTelegramTransport({ send: () => ({ status: 401, ok: false, json: { ok: false, error_code: 401 } }) }).transport);
    expect((await provider.sendMessage(base)).failureCode).toBe('TG_AUTH');
    setTelegramTransportForTesting(makeTelegramTransport({ send: () => ({ status: 429, ok: false, json: { ok: false, error_code: 429 } }) }).transport);
    expect((await provider.sendMessage(base)).retryable).toBe(true);
  });
  it('health: getMe HEALTHY / 401 AUTH_EXPIRED / 5xx DEGRADED', async () => {
    setTelegramTransportForTesting(makeTelegramTransport().transport);
    expect((await provider.checkConnection({ credentials: creds })).state).toBe('HEALTHY');
    setTelegramTransportForTesting(makeTelegramTransport({ getMe: () => ({ status: 401, ok: false, json: { ok: false, error_code: 401 } }) }).transport);
    expect((await provider.checkConnection({ credentials: creds })).state).toBe('AUTH_EXPIRED');
    setTelegramTransportForTesting(makeTelegramTransport({ getMe: () => ({ status: 500, ok: false, json: { ok: false, error_code: 500 } }) }).transport);
    expect((await provider.checkConnection({ credentials: creds })).state).toBe('DEGRADED');
  });
  it('registerWebhook returns ok', async () => {
    setTelegramTransportForTesting(makeTelegramTransport().transport);
    expect((await provider.registerWebhook({ botToken: TG.botToken, url: 'https://x/y', secretToken: 's' })).ok).toBe(true);
  });
});

describe('Telegram error classifier', () => {
  it('maps error codes to categories', () => {
    expect(classifyTelegram(401, { ok: false, error_code: 401 }).category).toBe('AUTHENTICATION');
    expect(classifyTelegram(429, { ok: false, error_code: 429 }).retryable).toBe(true);
    expect(classifyTelegram(500, { ok: false, error_code: 500 }).category).toBe('TEMPORARY_PROVIDER_FAILURE');
    expect(classifyTelegram(400, { ok: false, error_code: 400 }).category).toBe('INVALID_REQUEST');
  });
});
