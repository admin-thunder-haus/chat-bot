import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';
import { prisma } from './setup';
import {
  setMetaOauthConfigForTesting,
  signOauthState,
  verifyOauthState,
  OAUTH_STATE_TTL_MS,
  type MetaOauthState,
} from '../src/modules/channels/oauth/meta-oauth.service';
import {
  setMetaOauthTransportForTesting,
  type MetaOauthTransport,
} from '../src/modules/channels/oauth/meta-oauth.graph';
import {
  setFacebookTransportForTesting,
  setWhatsAppTransportForTesting,
} from '../src/modules/channels';
import { makeFacebookTransport, FB } from './facebook-helpers';
import { makeWhatsAppTransport } from './whatsapp-helpers';

const app = createApp();
let acme: Tenant;

/** Deterministic Meta app config used when the flow should be "configured". */
const META = {
  appId: '1234567890',
  appSecret: 'test-meta-app-secret-abcdef',
  whatsappConfigId: 'wa-es-config-1',
  loginConfigId: 'login-config-1',
  frontendUrl: 'http://frontend.test',
};

const USER_TOKEN = 'EAAU-user-token-1234567890';
const WA_BUSINESS_TOKEN = 'EAAB-business-token-0987654321';
const WABA_ID = '5550001112223334';
const PHONE_ID = '1029384756';

/**
 * Fake Graph transport for the OAuth flow. Routes on URL substrings; records
 * every call so tests can assert subscriptions happened.
 */
function makeMetaTransport(
  overrides: Partial<{
    exchange: () => { status: number; ok: boolean; json: unknown };
    pages: () => { status: number; ok: boolean; json: unknown };
    debug: () => { status: number; ok: boolean; json: unknown };
    phones: () => { status: number; ok: boolean; json: unknown };
    subscribe: () => { status: number; ok: boolean; json: unknown };
  }> = {},
): { transport: MetaOauthTransport; calls: { method: string; url: string }[] } {
  const calls: { method: string; url: string }[] = [];
  const transport: MetaOauthTransport = {
    async request(input) {
      calls.push({ method: input.method, url: input.url });
      if (input.url.includes('/oauth/access_token')) {
        return (
          overrides.exchange?.() ?? {
            status: 200,
            ok: true,
            json: {
              access_token: input.url.includes(`client_id=${META.appId}`)
                ? input.url.includes('redirect_uri')
                  ? USER_TOKEN
                  : WA_BUSINESS_TOKEN
                : USER_TOKEN,
            },
          }
        );
      }
      if (input.url.includes('/me/accounts')) {
        return (
          overrides.pages?.() ?? {
            status: 200,
            ok: true,
            json: {
              data: [
                {
                  id: FB.pageId,
                  name: FB.pageName,
                  access_token: FB.accessToken,
                  instagram_business_account: { id: '17840000000000001' },
                },
              ],
            },
          }
        );
      }
      if (input.url.includes('/debug_token')) {
        return (
          overrides.debug?.() ?? {
            status: 200,
            ok: true,
            json: {
              data: {
                granular_scopes: [
                  {
                    scope: 'whatsapp_business_management',
                    target_ids: [WABA_ID],
                  },
                ],
              },
            },
          }
        );
      }
      if (input.url.includes('/phone_numbers')) {
        return (
          overrides.phones?.() ?? {
            status: 200,
            ok: true,
            json: {
              data: [
                {
                  id: PHONE_ID,
                  display_phone_number: '+1 555 010 0000',
                  verified_name: 'Acme WhatsApp',
                },
              ],
            },
          }
        );
      }
      if (input.url.includes('/subscribed_apps')) {
        return overrides.subscribe?.() ?? { status: 200, ok: true, json: { success: true } };
      }
      return { status: 404, ok: false, json: null };
    },
  };
  return { transport, calls };
}

function configure(): void {
  setMetaOauthConfigForTesting({ ...META });
}

beforeEach(async () => {
  acme = await setupTenant('acme');
  // Health checks run through the real provider clients — inject fakes.
  setFacebookTransportForTesting(makeFacebookTransport().transport);
  setWhatsAppTransportForTesting(makeWhatsAppTransport().transport);
});

afterEach(() => {
  setMetaOauthConfigForTesting(null);
  setMetaOauthTransportForTesting(null);
  setFacebookTransportForTesting(null);
  setWhatsAppTransportForTesting(null);
});

async function startFlow(provider: string, token = acme.tokens.owner) {
  return request(app)
    .post('/api/v1/channels/oauth/meta/start')
    .set(authHeader(token))
    .send({ provider });
}

/** Run /meta/start and pull the signed state out of the authorize URL. */
async function mintState(provider: string): Promise<string> {
  const res = await startFlow(provider);
  expect(res.status).toBe(200);
  return new URL(res.body.data.url).searchParams.get('state')!;
}

describe('Meta OAuth — status + start (unconfigured)', () => {
  it('reports configured:false and start returns 409 OAUTH_NOT_CONFIGURED', async () => {
    const status = await request(app)
      .get('/api/v1/channels/oauth/meta/status')
      .set(authHeader(acme.tokens.owner));
    expect(status.status).toBe(200);
    expect(status.body.data.configured).toBe(false);

    const start = await startFlow('facebook');
    expect(start.status).toBe(409);
    expect(start.body.code).toBe('OAUTH_NOT_CONFIGURED');
  });

  it('callback while unconfigured redirects with a safe error code', async () => {
    const res = await request(app).get(
      '/api/v1/channels/oauth/meta/callback?code=x&state=y',
    );
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('connect_error=OAUTH_NOT_CONFIGURED');
  });
});

describe('Meta OAuth — signed state', () => {
  const base: MetaOauthState = {
    companyId: 'c-1',
    userId: 'u-1',
    provider: 'facebook',
    nonce: 'n-1',
    iat: 0,
  };

  it('round-trips sign → verify', () => {
    const raw = signOauthState({ ...base, iat: Date.now() });
    const parsed = verifyOauthState(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.companyId).toBe('c-1');
    expect(parsed!.provider).toBe('facebook');
  });

  it('rejects expired state (10-minute TTL)', () => {
    const raw = signOauthState({
      ...base,
      iat: Date.now() - OAUTH_STATE_TTL_MS - 1000,
    });
    expect(verifyOauthState(raw)).toBeNull();
  });

  it('rejects tampered payload and tampered signature', () => {
    const raw = signOauthState({ ...base, iat: Date.now() });
    const [payload, sig] = raw.split('.');
    // Swap in a payload claiming another company but keep the old signature.
    const forged = Buffer.from(
      JSON.stringify({ ...base, companyId: 'other-co', iat: Date.now() }),
    ).toString('base64url');
    expect(verifyOauthState(`${forged}.${sig}`)).toBeNull();
    expect(verifyOauthState(`${payload}.AAAA${sig.slice(4)}`)).toBeNull();
    expect(verifyOauthState('garbage')).toBeNull();
  });
});

describe('Meta OAuth — start (configured)', () => {
  beforeEach(configure);

  it('returns the Meta authorize URL with config_id + signed state', async () => {
    const res = await startFlow('facebook');
    expect(res.status).toBe(200);
    const url = new URL(res.body.data.url);
    expect(url.origin).toBe('https://www.facebook.com');
    expect(url.pathname).toBe('/v21.0/dialog/oauth');
    expect(url.searchParams.get('client_id')).toBe(META.appId);
    expect(url.searchParams.get('config_id')).toBe(META.loginConfigId);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toContain(
      '/api/v1/channels/oauth/meta/callback',
    );
    const state = verifyOauthState(url.searchParams.get('state')!);
    expect(state?.companyId).toBe(acme.company.id);
    // Never leak the app secret into the URL.
    expect(res.body.data.url).not.toContain(META.appSecret);
  });

  it('uses the Embedded Signup config for whatsapp; AGENT is forbidden', async () => {
    const res = await startFlow('whatsapp');
    expect(new URL(res.body.data.url).searchParams.get('config_id')).toBe(
      META.whatsappConfigId,
    );
    expect((await startFlow('facebook', acme.tokens.agent)).status).toBe(403);
  });
});

describe('Meta OAuth — facebook callback', () => {
  beforeEach(configure);

  it('connects the first granted Page and redirects with ?connected=facebook', async () => {
    const meta = makeMetaTransport();
    setMetaOauthTransportForTesting(meta.transport);
    const state = await mintState('facebook');

    const res = await request(app)
      .get('/api/v1/channels/oauth/meta/callback')
      .query({ code: 'auth-code-1', state });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      `${META.frontendUrl}/dashboard/channels?connected=facebook`,
    );

    const account = await prisma.channelAccount.findFirst({
      where: { companyId: acme.company.id, providerKey: 'facebook' },
    });
    expect(account).not.toBeNull();
    expect(account!.externalAccountId).toBe(FB.pageId);
    expect(account!.status).toBe('CONNECTED');

    // Credentials stored encrypted — never the raw page token.
    const cred = await prisma.channelCredential.findFirst({
      where: { channelAccountId: account!.id },
    });
    expect(cred).not.toBeNull();
    expect(cred!.encryptedPayload).not.toContain(FB.accessToken);
    expect(cred!.encryptedPayload).not.toContain(META.appSecret);

    // App subscribed to the Page's webhooks (messages field).
    expect(
      meta.calls.some(
        (c) => c.method === 'POST' && c.url.includes(`${FB.pageId}/subscribed_apps`),
      ),
    ).toBe(true);
  });

  it('redirects with connect_error on a tampered state (no account created)', async () => {
    setMetaOauthTransportForTesting(makeMetaTransport().transport);
    const res = await request(app)
      .get('/api/v1/channels/oauth/meta/callback')
      .query({ code: 'auth-code-1', state: 'not-a-real-state' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      `${META.frontendUrl}/dashboard/channels?connect_error=INVALID_STATE`,
    );
    expect(await prisma.channelAccount.count()).toBe(0);
  });

  it('maps a failed token exchange and a duplicate Page to safe codes', async () => {
    const failing = makeMetaTransport({
      exchange: () => ({ status: 400, ok: false, json: { error: { code: 100 } } }),
    });
    setMetaOauthTransportForTesting(failing.transport);
    const res = await request(app)
      .get('/api/v1/channels/oauth/meta/callback')
      .query({ code: 'bad', state: await mintState('facebook') });
    expect(res.headers.location).toContain('connect_error=TOKEN_EXCHANGE_FAILED');

    // Connect once successfully, then replay → ALREADY_CONNECTED.
    setMetaOauthTransportForTesting(makeMetaTransport().transport);
    const ok = await request(app)
      .get('/api/v1/channels/oauth/meta/callback')
      .query({ code: 'c1', state: await mintState('facebook') });
    expect(ok.headers.location).toContain('connected=facebook');
    const dup = await request(app)
      .get('/api/v1/channels/oauth/meta/callback')
      .query({ code: 'c2', state: await mintState('facebook') });
    expect(dup.headers.location).toContain('connect_error=ALREADY_CONNECTED');
  });

  it('user-denied dialog maps to ACCESS_DENIED', async () => {
    const res = await request(app)
      .get('/api/v1/channels/oauth/meta/callback')
      .query({ error: 'access_denied', error_code: '200' });
    expect(res.headers.location).toContain('connect_error=ACCESS_DENIED');
  });
});

describe('Meta OAuth — instagram callback', () => {
  beforeEach(configure);

  it('requires the Page to have a linked Instagram business account', async () => {
    setMetaOauthTransportForTesting(
      makeMetaTransport({
        pages: () => ({
          status: 200,
          ok: true,
          json: {
            data: [{ id: FB.pageId, name: FB.pageName, access_token: FB.accessToken }],
          },
        }),
      }).transport,
    );
    const res = await request(app)
      .get('/api/v1/channels/oauth/meta/callback')
      .query({ code: 'c', state: await mintState('instagram') });
    expect(res.headers.location).toContain('connect_error=NO_INSTAGRAM_ACCOUNT');
    expect(await prisma.channelAccount.count()).toBe(0);
  });

  it('connects the linked Instagram account via the existing connect service', async () => {
    setMetaOauthTransportForTesting(makeMetaTransport().transport);
    const res = await request(app)
      .get('/api/v1/channels/oauth/meta/callback')
      .query({ code: 'c', state: await mintState('instagram') });
    expect(res.headers.location).toContain('connected=instagram');
    const account = await prisma.channelAccount.findFirst({
      where: { companyId: acme.company.id, providerKey: 'instagram' },
    });
    expect(account?.externalAccountId).toBe('17840000000000001');
    expect(account?.externalPageId).toBe(FB.pageId);
  });
});

describe('Meta OAuth — whatsapp complete (Embedded Signup popup)', () => {
  beforeEach(configure);

  it('exchanges the code, discovers WABA + phone, connects and subscribes', async () => {
    const meta = makeMetaTransport();
    setMetaOauthTransportForTesting(meta.transport);

    const res = await request(app)
      .post('/api/v1/channels/oauth/meta/whatsapp/complete')
      .set(authHeader(acme.tokens.owner))
      .send({ code: 'es-code-1' });

    expect(res.status).toBe(201);
    const account = res.body.data.account;
    expect(account.providerKey).toBe('whatsapp');
    expect(account.externalAccountId).toBe(PHONE_ID);
    expect(account.externalPageId).toBe(WABA_ID);
    // No secrets in the response.
    const dump = JSON.stringify(res.body);
    expect(dump).not.toContain(WA_BUSINESS_TOKEN);
    expect(dump).not.toContain(META.appSecret);

    const cred = await prisma.channelCredential.findFirst({
      where: { channelAccountId: account.id },
    });
    expect(cred).not.toBeNull();
    expect(cred!.encryptedPayload).not.toContain(WA_BUSINESS_TOKEN);

    // WABA-level webhook subscription attempted.
    expect(
      meta.calls.some(
        (c) => c.method === 'POST' && c.url.includes(`${WABA_ID}/subscribed_apps`),
      ),
    ).toBe(true);
  });

  it('honors explicit phoneNumberId/wabaId from the popup and rejects AGENT', async () => {
    setMetaOauthTransportForTesting(makeMetaTransport().transport);
    const res = await request(app)
      .post('/api/v1/channels/oauth/meta/whatsapp/complete')
      .set(authHeader(acme.tokens.admin))
      .send({ code: 'es-code-2', phoneNumberId: '777', wabaId: '888' });
    expect(res.status).toBe(201);
    expect(res.body.data.account.externalAccountId).toBe('777');
    expect(res.body.data.account.externalPageId).toBe('888');

    const agent = await request(app)
      .post('/api/v1/channels/oauth/meta/whatsapp/complete')
      .set(authHeader(acme.tokens.agent))
      .send({ code: 'x' });
    expect(agent.status).toBe(403);
  });

  it('returns a safe 400 code when no WABA was shared', async () => {
    setMetaOauthTransportForTesting(
      makeMetaTransport({
        debug: () => ({ status: 200, ok: true, json: { data: { granular_scopes: [] } } }),
      }).transport,
    );
    const res = await request(app)
      .post('/api/v1/channels/oauth/meta/whatsapp/complete')
      .set(authHeader(acme.tokens.owner))
      .send({ code: 'es-code-3' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NO_WABA');
  });

  it('whatsapp redirect-callback variant also connects end to end', async () => {
    setMetaOauthTransportForTesting(makeMetaTransport().transport);
    const res = await request(app)
      .get('/api/v1/channels/oauth/meta/callback')
      .query({ code: 'wa-code', state: await mintState('whatsapp') });
    expect(res.headers.location).toContain('connected=whatsapp');
    const account = await prisma.channelAccount.findFirst({
      where: { companyId: acme.company.id, providerKey: 'whatsapp' },
    });
    expect(account?.externalPageId).toBe(WABA_ID);
  });
});
