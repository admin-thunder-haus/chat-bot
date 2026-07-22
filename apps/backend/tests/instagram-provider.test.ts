import { createHmac } from 'node:crypto';
import {
  InstagramChannelProvider,
  setInstagramTransportForTesting,
  classifyInstagramHttp,
} from '../src/modules/channels';
import {
  IG,
  makeInstagramTransport,
  igTextPayload,
  igEchoPayload,
  igReadPayload,
  igAttachmentPayload,
  igChangesTextPayload,
} from './instagram-helpers';

const provider = new InstagramChannelProvider();
const creds = {
  accessToken: IG.accessToken,
  appSecret: IG.appSecret,
  verifyToken: IG.verifyToken,
};

afterEach(() => setInstagramTransportForTesting(null));

describe('Instagram provider — registration & capabilities', () => {
  it('is a real, credentialed INSTAGRAM provider', () => {
    expect(provider.key).toBe('instagram');
    expect(provider.channelType).toBe('INSTAGRAM');
    expect(provider.developmentOnly).toBe(false);
    expect(provider.requiresCredentials).toBe(true);
  });

  it('advertises text + read + webhook + media capabilities honestly; templates/delivery OFF', () => {
    const c = provider.capabilities;
    expect(c.textMessages).toBe(true);
    expect(c.inboundMessaging).toBe(true);
    expect(c.outboundMessaging).toBe(true);
    expect(c.messageReplies).toBe(true);
    expect(c.readReceipts).toBe(true);
    expect(c.webhookVerification).toBe(true);
    expect(c.webhookSignatures).toBe(true);
    // Instagram DMs do not emit delivery receipts.
    expect(c.deliveryReceipts).toBe(false);
    expect(c.mediaMessages).toBe(true);
    expect(c.templates).toBe(false);
    expect(c.reactions).toBe(false);
    expect(c.typingIndicators).toBe(false);
  });
});

describe('Instagram provider — connection preparation', () => {
  it('splits payload into safe account shape + secret credentials', () => {
    const prep = provider.prepareConnection({
      displayName: 'IG',
      payload: {
        instagramAccountId: IG.instagramAccountId,
        facebookPageId: IG.facebookPageId,
        instagramUsername: IG.instagramUsername,
        accessToken: IG.accessToken,
        appSecret: IG.appSecret,
        verifyToken: IG.verifyToken,
      },
    });
    expect(prep.externalAccountId).toBe(IG.instagramAccountId);
    expect(prep.externalPageId).toBe(IG.facebookPageId);
    expect(prep.metadata?.instagram).toMatchObject({
      instagramAccountId: IG.instagramAccountId,
      instagramUsername: IG.instagramUsername,
    });
    expect(prep.secretCredentials).toMatchObject({ accessToken: IG.accessToken });
    // Credentials must never appear in the safe metadata.
    expect(JSON.stringify(prep.metadata)).not.toContain(IG.accessToken);
    expect(JSON.stringify(prep.metadata)).not.toContain(IG.appSecret);
  });

  it('rejects a payload missing required identifiers/secrets', () => {
    expect(() =>
      provider.prepareConnection({ displayName: 'IG', payload: { accessToken: 'x' } }),
    ).toThrow(/Validation failed/);
  });
});

describe('Instagram provider — webhook verification', () => {
  it('echoes the challenge for a valid verify token', async () => {
    const res = await provider.verifyWebhookChallenge({
      query: { 'hub.mode': 'subscribe', 'hub.verify_token': IG.verifyToken, 'hub.challenge': 'ping' },
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
      (await provider.verifyWebhookChallenge({ query: { 'hub.mode': 'unsubscribe', 'hub.verify_token': IG.verifyToken }, headers: {}, credentials: creds })).verified,
    ).toBe(false);
    expect(
      (await provider.verifyWebhookChallenge({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': IG.verifyToken }, headers: {}, credentials: null })).verified,
    ).toBe(false);
  });
});

describe('Instagram provider — signature validation (X-Hub-Signature-256)', () => {
  const raw = Buffer.from(JSON.stringify({ hello: 'world' }));
  const good = 'sha256=' + createHmac('sha256', IG.appSecret).update(raw).digest('hex');

  it('accepts a correct HMAC signature', async () => {
    expect(
      await provider.validateWebhookSignature({ rawBody: raw, headers: { 'x-hub-signature-256': good }, credentials: creds }),
    ).toBe(true);
  });

  it('rejects a bad signature, missing header, missing credentials, or tampered body', async () => {
    expect(await provider.validateWebhookSignature({ rawBody: raw, headers: { 'x-hub-signature-256': 'sha256=bad' }, credentials: creds })).toBe(false);
    expect(await provider.validateWebhookSignature({ rawBody: raw, headers: {}, credentials: creds })).toBe(false);
    expect(await provider.validateWebhookSignature({ rawBody: raw, headers: { 'x-hub-signature-256': good }, credentials: null })).toBe(false);
    const tampered = Buffer.from(JSON.stringify({ hello: 'world', x: 1 }));
    expect(await provider.validateWebhookSignature({ rawBody: tampered, headers: { 'x-hub-signature-256': good }, credentials: creds })).toBe(false);
  });
});

describe('Instagram provider — webhook parsing / normalization', () => {
  const parse = (body: unknown) =>
    provider.parseWebhook({ channelType: 'INSTAGRAM', body, headers: {}, credentials: creds });

  it('normalizes a valid inbound text message', async () => {
    const events = await parse(igTextPayload({ mid: 'ig.1', text: 'hello there' }));
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.kind).toBe('incoming_message');
    if (e.kind === 'incoming_message') {
      expect(e.externalMessageId).toBe('ig.1');
      expect(e.content).toBe('hello there');
      expect(e.customer.externalCustomerId).toBe(IG.customerIgsid);
      expect(e.channelType).toBe('INSTAGRAM');
    }
  });

  it('normalizes an inbound text in the CHANGES format (Instagram Login)', async () => {
    const events = await parse(igChangesTextPayload({ mid: 'ig.chg.1', text: 'via changes' }));
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.kind).toBe('incoming_message');
    if (e.kind === 'incoming_message') {
      expect(e.externalMessageId).toBe('ig.chg.1');
      expect(e.content).toBe('via changes');
      expect(e.customer.externalCustomerId).toBe(IG.customerIgsid);
      // Seconds timestamp scaled to a valid 2018 date (not 1970).
      expect(e.timestamp.getUTCFullYear()).toBe(2018);
    }
  });

  it('normalizes multiple messaging events in one webhook', async () => {
    const body = {
      object: 'instagram',
      entry: [
        {
          id: IG.instagramAccountId,
          messaging: [
            { sender: { id: 'a' }, recipient: { id: IG.instagramAccountId }, timestamp: 1, message: { mid: 'm1', text: 'one' } },
            { sender: { id: 'b' }, recipient: { id: IG.instagramAccountId }, timestamp: 2, message: { mid: 'm2', text: 'two' } },
          ],
        },
      ],
    };
    const events = await parse(body);
    expect(events.filter((e) => e.kind === 'incoming_message')).toHaveLength(2);
  });

  it('records an echo as unsupported (never ingested as text)', async () => {
    const events = await parse(igEchoPayload({ mid: 'ig.echo', text: 'sent by us' }));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('unsupported');
  });

  it('normalizes a read receipt', async () => {
    const events = await parse(igReadPayload({ mid: 'ig.out.1' }));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('read_receipt');
    if (events[0].kind === 'read_receipt') expect(events[0].externalMessageId).toBe('ig.out.1');
  });

  it('records a media attachment as unsupported', async () => {
    const events = await parse(igAttachmentPayload({ mid: 'ig.media', type: 'image' }));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('unsupported');
    if (events[0].kind === 'unsupported') expect(events[0].eventType).toBe('message.image');
  });

  it('handles malformed / unknown-future / empty payloads without throwing', async () => {
    expect(await parse({})).toEqual([]);
    expect(await parse({ object: 'instagram' })).toEqual([]);
    expect(await parse({ object: 'instagram', entry: [] })).toEqual([]);
    expect(await parse({ object: 'instagram', entry: [{ id: 'x', messaging: [{}] }] })).toEqual([]);
    expect(await parse({ object: 'something_else', entry: [{}] })).toEqual([]);
    expect(await parse({ object: 'instagram', entry: [{ id: 'x', messaging: [{ some_future_field: true }] }] })).toEqual([]);
    expect(await parse(null)).toEqual([]);
    expect(await parse('not-json')).toEqual([]);
  });
});

describe('Instagram provider — outbound send', () => {
  const base = {
    channelType: 'INSTAGRAM' as const,
    externalAccountId: IG.instagramAccountId,
    externalCustomerId: IG.customerIgsid,
    text: 'hi from agent',
    credentials: creds,
  };

  it('sends text and returns the external message id', async () => {
    const { transport, calls } = makeInstagramTransport();
    setInstagramTransportForTesting(transport);
    const res = await provider.sendMessage(base);
    expect(res.status).toBe('sent');
    expect(res.externalMessageId).toMatch(/^ig\.OUT\./);
    expect(calls[0].url).toContain(`${IG.instagramAccountId}/messages`);
    // The token must never appear in the recorded call URL.
    expect(calls[0].url).not.toContain(IG.accessToken);
  });

  it('classifies auth (401) as permanent', async () => {
    setInstagramTransportForTesting(
      makeInstagramTransport({ send: () => ({ status: 401, ok: false, json: { error: { code: 190 } } }) }).transport,
    );
    const res = await provider.sendMessage(base);
    expect(res.status).toBe('failed');
    expect(res.retryable).toBe(false);
    expect(res.failureCode).toBe('IG_AUTH');
  });

  it('classifies missing permission as permanent', async () => {
    setInstagramTransportForTesting(
      makeInstagramTransport({ send: () => ({ status: 400, ok: false, json: { error: { code: 10 } } }) }).transport,
    );
    const res = await provider.sendMessage(base);
    expect(res.retryable).toBe(false);
    expect(res.failureCode).toBe('IG_PERMISSION');
  });

  it('classifies 429 and 5xx as retryable', async () => {
    setInstagramTransportForTesting(
      makeInstagramTransport({ send: () => ({ status: 429, ok: false, json: {} }) }).transport,
    );
    expect((await provider.sendMessage(base)).retryable).toBe(true);
    setInstagramTransportForTesting(
      makeInstagramTransport({ send: () => ({ status: 503, ok: false, json: {} }) }).transport,
    );
    expect((await provider.sendMessage(base)).retryable).toBe(true);
  });

  it('classifies a network throw as retryable', async () => {
    setInstagramTransportForTesting({
      async request() {
        throw new Error('socket hang up');
      },
    });
    const res = await provider.sendMessage(base);
    expect(res.status).toBe('failed');
    expect(res.retryable).toBe(true);
    expect(res.failureCode).toBe('IG_NETWORK');
  });

  it('fails safely when recipient or account is missing (no throw)', async () => {
    expect((await provider.sendMessage({ ...base, externalCustomerId: null })).failureCode).toBe('IG_NO_RECIPIENT');
    expect((await provider.sendMessage({ ...base, externalAccountId: null })).failureCode).toBe('IG_NOT_CONFIGURED');
  });
});

describe('Instagram provider — health check', () => {
  it('returns HEALTHY for a valid token/account', async () => {
    setInstagramTransportForTesting(makeInstagramTransport().transport);
    const res = await provider.checkConnection({ externalAccountId: IG.instagramAccountId, credentials: creds });
    expect(res.state).toBe('HEALTHY');
  });

  it('returns AUTH_EXPIRED for an invalid token', async () => {
    setInstagramTransportForTesting(
      makeInstagramTransport({ check: () => ({ status: 401, ok: false, json: { error: { code: 190 } } }) }).transport,
    );
    const res = await provider.checkConnection({ externalAccountId: IG.instagramAccountId, credentials: creds });
    expect(res.state).toBe('AUTH_EXPIRED');
  });

  it('returns DEGRADED for a missing permission or temporary Meta failure', async () => {
    setInstagramTransportForTesting(
      makeInstagramTransport({ check: () => ({ status: 403, ok: false, json: { error: { code: 200 } } }) }).transport,
    );
    expect((await provider.checkConnection({ externalAccountId: IG.instagramAccountId, credentials: creds })).state).toBe('DEGRADED');
    setInstagramTransportForTesting(
      makeInstagramTransport({ check: () => ({ status: 503, ok: false, json: {} }) }).transport,
    );
    expect((await provider.checkConnection({ externalAccountId: IG.instagramAccountId, credentials: creds })).state).toBe('DEGRADED');
  });

  it('treats any successful account read as HEALTHY (Instagram Login exposes id + user_id)', async () => {
    // A 200 proves the token controls the queried account; a returned id that
    // differs from the entered one (id vs user_id) is NOT a mismatch.
    setInstagramTransportForTesting(
      makeInstagramTransport({ check: () => ({ status: 200, ok: true, json: { id: '999', username: 'other' } }) }).transport,
    );
    const res = await provider.checkConnection({ externalAccountId: IG.instagramAccountId, credentials: creds });
    expect(res.state).toBe('HEALTHY');
  });
});

describe('Instagram provider — profile enrichment', () => {
  it('fetches a sender profile (name + username)', async () => {
    setInstagramTransportForTesting(makeInstagramTransport().transport);
    const p = await provider.fetchCustomerProfile({ externalCustomerId: IG.customerIgsid, credentials: creds });
    expect(p?.username).toBe(IG.instagramUsername);
    expect(p?.fullName).toBe(IG.businessName);
  });
  it('returns null without credentials or on error', async () => {
    expect(await provider.fetchCustomerProfile({ externalCustomerId: 'x', credentials: null })).toBeNull();
    setInstagramTransportForTesting(makeInstagramTransport({ check: () => ({ status: 400, ok: false, json: {} }) }).transport);
    expect(await provider.fetchCustomerProfile({ externalCustomerId: IG.customerIgsid, credentials: creds })).toBeNull();
  });
});

describe('Instagram error classifier', () => {
  it('maps codes/subcodes to the correct categories', () => {
    expect(classifyInstagramHttp(400, { error: { code: 190 } }).category).toBe('AUTHENTICATION');
    expect(classifyInstagramHttp(400, { error: { code: 10 } }).category).toBe('AUTHORIZATION');
    expect(classifyInstagramHttp(400, { error: { code: 4 } }).category).toBe('RATE_LIMIT');
    expect(classifyInstagramHttp(400, { error: { code: 100, error_subcode: 2534014 } }).category).toBe('INVALID_RECIPIENT');
    expect(classifyInstagramHttp(500, {}).category).toBe('TEMPORARY_PROVIDER_FAILURE');
    expect(classifyInstagramHttp(429, {}).retryable).toBe(true);
    expect(classifyInstagramHttp(400, { error: { code: 190 } }).retryable).toBe(false);
  });
});
