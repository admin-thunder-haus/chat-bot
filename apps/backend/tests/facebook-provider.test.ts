import { createHmac } from 'node:crypto';
import {
  FacebookChannelProvider,
  setFacebookTransportForTesting,
  classifyFacebookHttp,
} from '../src/modules/channels';
import {
  FB,
  makeFacebookTransport,
  fbTextPayload,
  fbEchoPayload,
  fbDeliveryPayload,
  fbAttachmentPayload,
} from './facebook-helpers';

const provider = new FacebookChannelProvider();
const creds = { accessToken: FB.accessToken, appSecret: FB.appSecret, verifyToken: FB.verifyToken };

afterEach(() => setFacebookTransportForTesting(null));

describe('Facebook provider — registration & capabilities', () => {
  it('is a real, credentialed FACEBOOK provider', () => {
    expect(provider.key).toBe('facebook');
    expect(provider.channelType).toBe('FACEBOOK');
    expect(provider.developmentOnly).toBe(false);
    expect(provider.requiresCredentials).toBe(true);
  });

  it('advertises text + delivery + webhook capabilities honestly; read/media/templates OFF', () => {
    const c = provider.capabilities;
    expect(c.textMessages).toBe(true);
    expect(c.inboundMessaging).toBe(true);
    expect(c.outboundMessaging).toBe(true);
    expect(c.deliveryReceipts).toBe(true);
    expect(c.webhookVerification).toBe(true);
    expect(c.webhookSignatures).toBe(true);
    // Messenger read receipts are watermark-based (not modeled per-message).
    expect(c.readReceipts).toBe(false);
    expect(c.mediaMessages).toBe(false);
    expect(c.templates).toBe(false);
  });
});

describe('Facebook provider — connection preparation', () => {
  it('splits payload into safe account shape + secret credentials', () => {
    const prep = provider.prepareConnection({
      displayName: 'FB',
      payload: { pageId: FB.pageId, pageName: FB.pageName, accessToken: FB.accessToken, appSecret: FB.appSecret, verifyToken: FB.verifyToken },
    });
    expect(prep.externalAccountId).toBe(FB.pageId);
    expect(prep.externalPageId).toBe(FB.pageId);
    expect(prep.metadata?.facebook).toMatchObject({ pageId: FB.pageId, pageName: FB.pageName });
    expect(JSON.stringify(prep.metadata)).not.toContain(FB.accessToken);
  });

  it('rejects a payload missing required identifiers/secrets', () => {
    expect(() => provider.prepareConnection({ displayName: 'FB', payload: { accessToken: 'x' } })).toThrow(/Validation failed/);
  });
});

describe('Facebook provider — webhook verification & signature', () => {
  it('echoes the challenge for a valid verify token; rejects otherwise', async () => {
    expect(await provider.verifyWebhookChallenge({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': FB.verifyToken, 'hub.challenge': 'ping' }, headers: {}, credentials: creds })).toEqual({ verified: true, challenge: 'ping' });
    expect((await provider.verifyWebhookChallenge({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'nope' }, headers: {}, credentials: creds })).verified).toBe(false);
  });

  it('validates the X-Hub-Signature-256 HMAC', async () => {
    const raw = Buffer.from(JSON.stringify({ a: 1 }));
    const good = 'sha256=' + createHmac('sha256', FB.appSecret).update(raw).digest('hex');
    expect(await provider.validateWebhookSignature({ rawBody: raw, headers: { 'x-hub-signature-256': good }, credentials: creds })).toBe(true);
    expect(await provider.validateWebhookSignature({ rawBody: raw, headers: { 'x-hub-signature-256': 'sha256=bad' }, credentials: creds })).toBe(false);
    expect(await provider.validateWebhookSignature({ rawBody: raw, headers: { 'x-hub-signature-256': good }, credentials: null })).toBe(false);
  });
});

describe('Facebook provider — parsing / normalization', () => {
  const parse = (body: unknown) => provider.parseWebhook({ channelType: 'FACEBOOK', body, headers: {}, credentials: creds });

  it('normalizes a valid inbound text message', async () => {
    const events = await parse(fbTextPayload({ mid: 'm.1', text: 'hey page' }));
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.kind).toBe('incoming_message');
    if (e.kind === 'incoming_message') {
      expect(e.content).toBe('hey page');
      expect(e.customer.externalCustomerId).toBe(FB.customerPsid);
      expect(e.channelType).toBe('FACEBOOK');
    }
  });

  it('emits a delivery_status per delivered mid', async () => {
    const events = await parse(fbDeliveryPayload({ mids: ['out.1', 'out.2'] }));
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.kind === 'delivery_status')).toBe(true);
    if (events[0].kind === 'delivery_status') expect(events[0].status).toBe('delivered');
  });

  it('records echo, read (watermark), and attachments as unsupported', async () => {
    expect((await parse(fbEchoPayload({ mid: 'e.1', text: 'x' })))[0].kind).toBe('unsupported');
    expect((await parse({ object: 'page', entry: [{ id: FB.pageId, messaging: [{ read: { watermark: 123 } }] }] }))[0].kind).toBe('unsupported');
    expect((await parse(fbAttachmentPayload({ mid: 'a.1', type: 'image' })))[0].kind).toBe('unsupported');
  });

  it('handles malformed / unknown / empty payloads without throwing', async () => {
    expect(await parse({})).toEqual([]);
    expect(await parse({ object: 'page', entry: [] })).toEqual([]);
    expect(await parse({ object: 'page', entry: [{ id: 'x', messaging: [{}] }] })).toEqual([]);
    expect(await parse({ object: 'instagram', entry: [{}] })).toEqual([]);
    expect(await parse(null)).toEqual([]);
    expect(await parse('nope')).toEqual([]);
  });
});

describe('Facebook provider — outbound send', () => {
  const base = { channelType: 'FACEBOOK' as const, externalAccountId: FB.pageId, externalCustomerId: FB.customerPsid, text: 'hi', credentials: creds };

  it('sends text and returns the external message id', async () => {
    const { transport, calls } = makeFacebookTransport();
    setFacebookTransportForTesting(transport);
    const res = await provider.sendMessage(base);
    expect(res.status).toBe('sent');
    expect(res.externalMessageId).toMatch(/^fb\.OUT\./);
    expect(calls[0].url).toContain(`${FB.pageId}/messages`);
    expect(calls[0].url).not.toContain(FB.accessToken);
  });

  it('classifies auth/permission as permanent and 429/5xx/network as retryable', async () => {
    setFacebookTransportForTesting(makeFacebookTransport({ send: () => ({ status: 401, ok: false, json: { error: { code: 190 } } }) }).transport);
    expect((await provider.sendMessage(base)).failureCode).toBe('FB_AUTH');
    setFacebookTransportForTesting(makeFacebookTransport({ send: () => ({ status: 403, ok: false, json: { error: { code: 10 } } }) }).transport);
    expect((await provider.sendMessage(base)).retryable).toBe(false);
    setFacebookTransportForTesting(makeFacebookTransport({ send: () => ({ status: 429, ok: false, json: {} }) }).transport);
    expect((await provider.sendMessage(base)).retryable).toBe(true);
    setFacebookTransportForTesting({ async request() { throw new Error('socket hang up'); } });
    expect((await provider.sendMessage(base)).failureCode).toBe('FB_NETWORK');
  });

  it('fails safely when recipient or Page is missing', async () => {
    expect((await provider.sendMessage({ ...base, externalCustomerId: null })).failureCode).toBe('FB_NO_RECIPIENT');
    expect((await provider.sendMessage({ ...base, externalAccountId: null })).failureCode).toBe('FB_NOT_CONFIGURED');
  });
});

describe('Facebook provider — health check', () => {
  it('returns HEALTHY / AUTH_EXPIRED / DEGRADED appropriately', async () => {
    setFacebookTransportForTesting(makeFacebookTransport().transport);
    expect((await provider.checkConnection({ externalAccountId: FB.pageId, credentials: creds })).state).toBe('HEALTHY');
    setFacebookTransportForTesting(makeFacebookTransport({ check: () => ({ status: 401, ok: false, json: { error: { code: 190 } } }) }).transport);
    expect((await provider.checkConnection({ externalAccountId: FB.pageId, credentials: creds })).state).toBe('AUTH_EXPIRED');
    setFacebookTransportForTesting(makeFacebookTransport({ check: () => ({ status: 503, ok: false, json: {} }) }).transport);
    expect((await provider.checkConnection({ externalAccountId: FB.pageId, credentials: creds })).state).toBe('DEGRADED');
  });
});

describe('Facebook provider — profile enrichment', () => {
  it('fetches a sender profile name', async () => {
    setFacebookTransportForTesting(makeFacebookTransport().transport);
    const p = await provider.fetchCustomerProfile({ externalCustomerId: FB.customerPsid, credentials: creds });
    expect(p?.fullName).toBe(FB.pageName);
  });
  it('returns null without credentials', async () => {
    expect(await provider.fetchCustomerProfile({ externalCustomerId: 'x', credentials: null })).toBeNull();
  });
});

describe('Facebook error classifier', () => {
  it('maps codes/status to categories', () => {
    expect(classifyFacebookHttp(400, { error: { code: 190 } }).category).toBe('AUTHENTICATION');
    expect(classifyFacebookHttp(400, { error: { code: 10 } }).category).toBe('AUTHORIZATION');
    expect(classifyFacebookHttp(429, {}).retryable).toBe(true);
    expect(classifyFacebookHttp(500, {}).category).toBe('TEMPORARY_PROVIDER_FAILURE');
  });
});
