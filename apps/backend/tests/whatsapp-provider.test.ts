import { createHmac } from 'node:crypto';
import {
  WhatsAppChannelProvider,
  setWhatsAppTransportForTesting,
} from '../src/modules/channels';
import { makeWhatsAppTransport, WA, metaTextPayload, metaStatusPayload } from './whatsapp-helpers';

const provider = new WhatsAppChannelProvider();
const creds = {
  accessToken: WA.accessToken,
  appSecret: WA.appSecret,
  verifyToken: WA.verifyToken,
};

afterEach(() => setWhatsAppTransportForTesting(null));

describe('WhatsApp provider — registration & capabilities', () => {
  it('is a real, credentialed WHATSAPP provider', () => {
    expect(provider.key).toBe('whatsapp');
    expect(provider.channelType).toBe('WHATSAPP');
    expect(provider.developmentOnly).toBe(false);
    expect(provider.requiresCredentials).toBe(true);
  });

  it('advertises text + webhook capabilities; media/templates OFF (architecture-ready)', () => {
    const c = provider.capabilities;
    expect(c.textMessages).toBe(true);
    expect(c.inboundMessaging).toBe(true);
    expect(c.outboundMessaging).toBe(true);
    expect(c.deliveryReceipts).toBe(true);
    expect(c.readReceipts).toBe(true);
    expect(c.webhookVerification).toBe(true);
    expect(c.webhookSignatures).toBe(true);
    expect(c.mediaMessages).toBe(false);
    expect(c.templates).toBe(false);
    expect(c.reactions).toBe(false);
  });
});

describe('WhatsApp provider — webhook verification', () => {
  it('echoes the challenge for a valid verify token', async () => {
    const res = await provider.verifyWebhookChallenge({
      query: { 'hub.mode': 'subscribe', 'hub.verify_token': WA.verifyToken, 'hub.challenge': 'ping' },
      headers: {},
      credentials: creds,
    });
    expect(res).toEqual({ verified: true, challenge: 'ping' });
  });

  it('rejects a wrong verify token, wrong mode, or missing credentials', async () => {
    expect(
      (await provider.verifyWebhookChallenge({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'nope' }, headers: {}, credentials: creds })).verified,
    ).toBe(false);
    expect(
      (await provider.verifyWebhookChallenge({ query: { 'hub.mode': 'unsubscribe', 'hub.verify_token': WA.verifyToken }, headers: {}, credentials: creds })).verified,
    ).toBe(false);
    expect(
      (await provider.verifyWebhookChallenge({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': WA.verifyToken }, headers: {}, credentials: null })).verified,
    ).toBe(false);
  });
});

describe('WhatsApp provider — signature validation (X-Hub-Signature-256)', () => {
  const raw = Buffer.from(JSON.stringify({ hello: 'world' }));
  const good = 'sha256=' + createHmac('sha256', WA.appSecret).update(raw).digest('hex');

  it('accepts a correct HMAC signature', async () => {
    const ok = await provider.validateWebhookSignature({
      rawBody: raw,
      headers: { 'x-hub-signature-256': good },
      credentials: creds,
    });
    expect(ok).toBe(true);
  });

  it('rejects a bad signature, missing header, or missing credentials', async () => {
    expect(await provider.validateWebhookSignature({ rawBody: raw, headers: { 'x-hub-signature-256': 'sha256=bad' }, credentials: creds })).toBe(false);
    expect(await provider.validateWebhookSignature({ rawBody: raw, headers: {}, credentials: creds })).toBe(false);
    expect(await provider.validateWebhookSignature({ rawBody: raw, headers: { 'x-hub-signature-256': good }, credentials: null })).toBe(false);
  });
});

describe('WhatsApp provider — webhook parsing (defensive)', () => {
  it('normalizes an inbound text message', async () => {
    const events = await provider.parseWebhook({
      channelType: 'WHATSAPP',
      body: metaTextPayload({ wamid: 'wamid.IN.1', from: '15551230000', text: 'Hello', name: 'Ada' }),
      headers: {},
    });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('incoming_message');
    if (events[0].kind === 'incoming_message') {
      expect(events[0].externalMessageId).toBe('wamid.IN.1');
      expect(events[0].customer.externalCustomerId).toBe('15551230000');
      expect(events[0].customer.fullName).toBe('Ada');
      expect(events[0].customer.phone).toBe('15551230000');
      expect(events[0].content).toBe('Hello');
    }
  });

  it('maps statuses: delivered -> delivery_status, read -> read_receipt', async () => {
    const delivered = await provider.parseWebhook({
      channelType: 'WHATSAPP',
      body: metaStatusPayload({ wamid: 'wamid.OUT.1', status: 'delivered' }),
      headers: {},
    });
    expect(delivered[0].kind).toBe('delivery_status');
    if (delivered[0].kind === 'delivery_status') {
      expect(delivered[0].status).toBe('delivered');
      expect(delivered[0].externalMessageId).toBe('wamid.OUT.1');
      expect(delivered[0].externalEventId).toBe('wamid.OUT.1:delivered');
    }
    const read = await provider.parseWebhook({
      channelType: 'WHATSAPP',
      body: metaStatusPayload({ wamid: 'wamid.OUT.1', status: 'read' }),
      headers: {},
    });
    expect(read[0].kind).toBe('read_receipt');
  });

  it('maps "accepted" -> sent and "failed" -> failed', async () => {
    const accepted = await provider.parseWebhook({
      channelType: 'WHATSAPP',
      body: metaStatusPayload({ wamid: 'w1', status: 'accepted' }),
      headers: {},
    });
    expect(accepted[0].kind === 'delivery_status' && accepted[0].status).toBe('sent');
    const failed = await provider.parseWebhook({
      channelType: 'WHATSAPP',
      body: metaStatusPayload({ wamid: 'w2', status: 'failed' }),
      headers: {},
    });
    expect(failed[0].kind === 'delivery_status' && failed[0].status).toBe('failed');
  });

  it('records non-text messages (media/location/etc.) as unsupported', async () => {
    const body = metaTextPayload({ wamid: 'wamid.IN.2', from: '15551230000', text: 'x' });
    // Mutate to an image message (architecture-ready, not processed).
    (body.entry[0].changes[0].value.messages[0] as { type: string; text?: unknown }).type = 'image';
    delete (body.entry[0].changes[0].value.messages[0] as { text?: unknown }).text;
    const events = await provider.parseWebhook({ channelType: 'WHATSAPP', body, headers: {} });
    expect(events[0].kind).toBe('unsupported');
    if (events[0].kind === 'unsupported') expect(events[0].eventType).toBe('message.image');
  });

  it('never crashes on malformed / empty / future-shaped payloads', async () => {
    for (const body of [
      null,
      {},
      { object: 'something_else', entry: [] },
      { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {} }] }] },
      { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'future_field', value: { brand_new: true } }] }] },
      { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages: [{ id: 'x' }] } }] }] }, // no `from`
      { entry: 'not-an-array' },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const events = await provider.parseWebhook({ channelType: 'WHATSAPP', body, headers: {} });
      expect(Array.isArray(events)).toBe(true);
    }
  });

  it('ignores unknown status values safely (future statuses)', async () => {
    const events = await provider.parseWebhook({
      channelType: 'WHATSAPP',
      body: metaStatusPayload({ wamid: 'w3', status: 'brand_new_status' }),
      headers: {},
    });
    expect(events[0].kind).toBe('unsupported');
  });
});

describe('WhatsApp provider — outbound send (Graph API, mocked)', () => {
  it('sends text and returns the wamid on success', async () => {
    const { transport, calls } = makeWhatsAppTransport();
    setWhatsAppTransportForTesting(transport);
    const res = await provider.sendMessage({
      channelType: 'WHATSAPP',
      externalAccountId: WA.phoneNumberId,
      externalCustomerId: '15551230000',
      text: 'Hi there',
      credentials: creds,
    });
    expect(res.status).toBe('sent');
    expect(res.externalMessageId).toMatch(/^wamid\.OUT\./);
    expect(calls[0].url).toContain(`/${WA.phoneNumberId}/messages`);
  });

  it('classifies 401 as a permanent failure (token expired)', async () => {
    setWhatsAppTransportForTesting(
      makeWhatsAppTransport({ send: () => ({ status: 401, ok: false, json: { error: { code: 190 } } }) }).transport,
    );
    const res = await provider.sendMessage({ channelType: 'WHATSAPP', externalAccountId: WA.phoneNumberId, externalCustomerId: '1', text: 'x', credentials: creds });
    expect(res.status).toBe('failed');
    expect(res.retryable).toBe(false);
  });

  it('classifies 429 and 5xx as retryable (transient)', async () => {
    setWhatsAppTransportForTesting(
      makeWhatsAppTransport({ send: () => ({ status: 429, ok: false, json: {} }) }).transport,
    );
    expect((await provider.sendMessage({ channelType: 'WHATSAPP', externalAccountId: WA.phoneNumberId, externalCustomerId: '1', text: 'x', credentials: creds })).retryable).toBe(true);
    setWhatsAppTransportForTesting(
      makeWhatsAppTransport({ send: () => ({ status: 503, ok: false, json: {} }) }).transport,
    );
    expect((await provider.sendMessage({ channelType: 'WHATSAPP', externalAccountId: WA.phoneNumberId, externalCustomerId: '1', text: 'x', credentials: creds })).retryable).toBe(true);
  });

  it('treats a network exception as retryable and fails safely without credentials', async () => {
    setWhatsAppTransportForTesting({
      async request() {
        throw new Error('ECONNRESET');
      },
    });
    expect((await provider.sendMessage({ channelType: 'WHATSAPP', externalAccountId: WA.phoneNumberId, externalCustomerId: '1', text: 'x', credentials: creds })).retryable).toBe(true);

    const noCreds = await provider.sendMessage({ channelType: 'WHATSAPP', externalAccountId: WA.phoneNumberId, externalCustomerId: '1', text: 'x', credentials: null });
    expect(noCreds.status).toBe('failed');
    expect(noCreds.retryable).toBe(false);
    expect(noCreds.failureCode).toBe('WA_NOT_CONFIGURED');
  });
});

describe('WhatsApp provider — health check', () => {
  it('reports HEALTHY when the phone number is reachable', async () => {
    setWhatsAppTransportForTesting(makeWhatsAppTransport().transport);
    const res = await provider.checkConnection({ externalAccountId: WA.phoneNumberId, credentials: creds });
    expect(res.state).toBe('HEALTHY');
  });

  it('reports AUTH_EXPIRED on a 401 and UNAVAILABLE without credentials', async () => {
    setWhatsAppTransportForTesting(
      makeWhatsAppTransport({ check: () => ({ status: 401, ok: false, json: { error: { code: 190 } } }) }).transport,
    );
    expect((await provider.checkConnection({ externalAccountId: WA.phoneNumberId, credentials: creds })).state).toBe('AUTH_EXPIRED');
    expect((await provider.checkConnection({ externalAccountId: WA.phoneNumberId, credentials: null })).state).toBe('UNAVAILABLE');
  });
});

describe('WhatsApp provider — connect preparation', () => {
  it('splits a connect payload into account fields + secret credentials', () => {
    const prep = provider.prepareConnection({
      displayName: 'WA',
      payload: {
        phoneNumberId: WA.phoneNumberId,
        wabaId: WA.wabaId,
        displayPhoneNumber: WA.displayPhoneNumber,
        accessToken: WA.accessToken,
        appSecret: WA.appSecret,
        verifyToken: WA.verifyToken,
      },
    });
    expect(prep.externalAccountId).toBe(WA.phoneNumberId);
    expect(prep.externalPageId).toBe(WA.wabaId);
    expect(prep.secretCredentials).toEqual(creds);
    expect((prep.metadata as { whatsapp: { phoneNumberId: string } }).whatsapp.phoneNumberId).toBe(WA.phoneNumberId);
  });

  it('rejects a payload missing required fields', () => {
    expect(() =>
      provider.prepareConnection!({ displayName: 'WA', payload: { phoneNumberId: WA.phoneNumberId } }),
    ).toThrow(/validation/i);
  });
});
