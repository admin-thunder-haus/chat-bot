import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';
import { prisma } from './setup';
import {
  setInstagramLoginConfigForTesting,
  signInstagramLoginState,
  verifyInstagramLoginState,
  INSTAGRAM_LOGIN_STATE_TTL_MS,
  type InstagramLoginState,
} from '../src/modules/channels/oauth/instagram-login.service';
import {
  setInstagramLoginTransportForTesting,
  type InstagramLoginTransport,
} from '../src/modules/channels/oauth/instagram-login.graph';
import {
  setMetaOauthConfigForTesting,
  signOauthState,
} from '../src/modules/channels/oauth/meta-oauth.service';
import {
  channelCredentialsService,
  setInstagramTransportForTesting,
  type InstagramTransport,
} from '../src/modules/channels';

/**
 * One-click Instagram connect via Instagram Login.
 *
 * The behaviours pinned here are the ones that were wrong before and produced a
 * channel that looked connected and received nothing: the account must be keyed
 * by the id Meta puts in webhooks, the stored secret must be the INSTAGRAM app
 * secret, the token must be the long-lived one, and the account must actually
 * end up subscribed.
 */

const app = createApp();
let acme: Tenant;
let globex: Tenant;

const IGL = {
  appId: 'ig-app-1234567890',
  appSecret: 'test-instagram-app-secret-abcdef',
  frontendUrl: 'http://frontend.test',
};

const SHORT_TOKEN = 'IGAAshort-lived-token-000';
const LONG_TOKEN = 'IGAAlong-lived-token-111';
/** What `GET /me?fields=user_id,username` reports — the webhook `entry[].id`. */
const IG_USER_ID = '17841400000000009';
const IG_USERNAME = 'acme.support';

interface Recorded {
  method: string;
  url: string;
  form?: Record<string, string>;
}

/**
 * Fake Business Login transport. Routes on URL substrings and records every
 * call, so tests can assert which host was used and in what order.
 */
function makeLoginTransport(
  overrides: Partial<{
    exchange: () => { status: number; ok: boolean; json: unknown };
    longLived: () => { status: number; ok: boolean; json: unknown };
    me: () => { status: number; ok: boolean; json: unknown };
  }> = {},
): { transport: InstagramLoginTransport; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const transport: InstagramLoginTransport = {
    async request(input) {
      calls.push({ method: input.method, url: input.url, form: input.form });
      if (input.url.includes('api.instagram.com/oauth/access_token')) {
        return (
          overrides.exchange?.() ?? {
            status: 200,
            ok: true,
            json: {
              data: [
                {
                  access_token: SHORT_TOKEN,
                  user_id: IG_USER_ID,
                  permissions: 'instagram_business_basic',
                },
              ],
            },
          }
        );
      }
      if (input.url.includes('ig_exchange_token')) {
        return (
          overrides.longLived?.() ?? {
            status: 200,
            ok: true,
            json: { access_token: LONG_TOKEN, expires_in: 5183944 },
          }
        );
      }
      return (
        overrides.me?.() ?? {
          status: 200,
          ok: true,
          json: { user_id: IG_USER_ID, username: IG_USERNAME, id: 'app-scoped-id' },
        }
      );
    },
  };
  return { transport, calls };
}

/** Fake provider transport (health check + subscribe run through this one). */
function makeProviderTransport(): {
  transport: InstagramTransport;
  calls: { method: string; url: string; accessToken: string }[];
} {
  const calls: { method: string; url: string; accessToken: string }[] = [];
  const transport: InstagramTransport = {
    async request(input) {
      calls.push({
        method: input.method,
        url: input.url,
        accessToken: input.accessToken,
      });
      if (input.url.includes('/subscribed_apps')) {
        return { status: 200, ok: true, json: { success: true } };
      }
      return {
        status: 200,
        ok: true,
        json: { id: IG_USER_ID, username: IG_USERNAME },
      };
    },
  };
  return { transport, calls };
}

let providerCalls: { method: string; url: string; accessToken: string }[] = [];

function configure(): void {
  setInstagramLoginConfigForTesting({ ...IGL });
}

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
  const provider = makeProviderTransport();
  providerCalls = provider.calls;
  setInstagramTransportForTesting(provider.transport);
});

afterEach(() => {
  setInstagramLoginConfigForTesting(null);
  setInstagramLoginTransportForTesting(null);
  setInstagramTransportForTesting(null);
  setMetaOauthConfigForTesting(null);
});

function startFlow(token: string) {
  return request(app)
    .post('/api/v1/channels/oauth/instagram-login/start')
    .set(authHeader(token));
}

/** Run start and pull the signed state out of the authorize URL. */
async function mintState(token = acme.tokens.owner): Promise<string> {
  const res = await startFlow(token);
  expect(res.status).toBe(200);
  return new URL(res.body.data.url).searchParams.get('state')!;
}

function callback(query: Record<string, string>) {
  return request(app)
    .get('/api/v1/channels/oauth/instagram-login/callback')
    .query(query);
}

describe('Instagram Login — status + start (unconfigured)', () => {
  it('reports configured:false and start returns 409 OAUTH_NOT_CONFIGURED', async () => {
    const status = await request(app)
      .get('/api/v1/channels/oauth/instagram-login/status')
      .set(authHeader(acme.tokens.owner));
    expect(status.status).toBe(200);
    expect(status.body.data.configured).toBe(false);
    expect(status.body.data.appId).toBeNull();

    const start = await startFlow(acme.tokens.owner);
    expect(start.status).toBe(409);
    expect(start.body.code).toBe('OAUTH_NOT_CONFIGURED');
  });

  it('callback while unconfigured redirects with a safe error code', async () => {
    const res = await callback({ code: 'x', state: 'y' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('connect_error=OAUTH_NOT_CONFIGURED');
  });

  it('is configured independently of the Facebook app credentials', async () => {
    // Meta OAuth fully configured must NOT imply Instagram Login is: they are
    // different app identities, and conflating them was the original bug.
    setMetaOauthConfigForTesting({
      appId: 'fb-app',
      appSecret: 'fb-secret',
      loginConfigId: 'login-config-1',
    });
    const status = await request(app)
      .get('/api/v1/channels/oauth/instagram-login/status')
      .set(authHeader(acme.tokens.owner));
    expect(status.body.data.configured).toBe(false);
  });
});

describe('Instagram Login — start', () => {
  beforeEach(() => configure());

  it('builds an instagram.com authorize URL with the messaging scopes', async () => {
    const res = await startFlow(acme.tokens.owner);
    expect(res.status).toBe(200);
    const url = new URL(res.body.data.url);

    // Instagram Login authorizes at Instagram, not at facebook.com.
    expect(url.origin).toBe('https://www.instagram.com');
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe(IGL.appId);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toContain(
      '/api/v1/channels/oauth/instagram-login/callback',
    );
    const scope = url.searchParams.get('scope') ?? '';
    expect(scope).toContain('instagram_business_basic');
    expect(scope).toContain('instagram_business_manage_messages');
    // The retired un-prefixed spellings must not come back.
    expect(scope).not.toContain('instagram_basic');
    expect(scope).not.toContain('instagram_manage_messages,');
  });

  it('never puts the app secret or the tenant id in the URL', async () => {
    const res = await startFlow(acme.tokens.owner);
    expect(res.body.data.url).not.toContain(IGL.appSecret);
    expect(res.body.data.url).not.toContain(acme.company.id);
  });

  it('AGENT cannot start the flow', async () => {
    const res = await startFlow(acme.tokens.agent);
    expect(res.status).toBe(403);
  });

  it('requires authentication', async () => {
    const res = await request(app).post(
      '/api/v1/channels/oauth/instagram-login/start',
    );
    expect(res.status).toBe(401);
  });
});

describe('Instagram Login — signed state', () => {
  const base: InstagramLoginState = {
    companyId: 'c-1',
    userId: 'u-1',
    nonce: 'n-1',
    iat: 0,
  };

  it('round-trips sign → verify', () => {
    const parsed = verifyInstagramLoginState(
      signInstagramLoginState({ ...base, iat: Date.now() }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.companyId).toBe('c-1');
  });

  it('rejects expired state (10-minute TTL)', () => {
    const raw = signInstagramLoginState({
      ...base,
      iat: Date.now() - INSTAGRAM_LOGIN_STATE_TTL_MS - 1000,
    });
    expect(verifyInstagramLoginState(raw)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const raw = signInstagramLoginState({ ...base, iat: Date.now() });
    const [payload, sig] = raw.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...base, companyId: 'other', iat: Date.now() }),
      'utf8',
    ).toString('base64url');
    expect(verifyInstagramLoginState(`${forged}.${sig}`)).toBeNull();
    expect(verifyInstagramLoginState(`${payload}.deadbeef`)).toBeNull();
  });

  it('does not accept a Meta OAuth state (domain separation)', () => {
    // Both flows sign with the same key. Without a context tag a state minted
    // for one would verify in the other and walk the browser down the wrong
    // discovery path.
    const metaState = signOauthState({
      companyId: 'c-1',
      userId: 'u-1',
      provider: 'instagram',
      nonce: 'n-1',
      iat: Date.now(),
    });
    expect(verifyInstagramLoginState(metaState)).toBeNull();
  });

  it('a Meta state is rejected by the Instagram callback', async () => {
    configure();
    setMetaOauthConfigForTesting({
      appId: 'fb-app',
      appSecret: 'fb-secret',
      loginConfigId: 'login-config-1',
    });
    const metaState = signOauthState({
      companyId: acme.company.id,
      userId: acme.users.owner.id,
      provider: 'instagram',
      nonce: 'n-1',
      iat: Date.now(),
    });
    const res = await callback({ code: 'c', state: metaState });
    expect(res.headers.location).toContain('connect_error=INVALID_STATE');
    expect(await prisma.channelAccount.count()).toBe(0);
  });
});

describe('Instagram Login — callback', () => {
  beforeEach(() => configure());

  it('connects the authorized account and subscribes it to webhooks', async () => {
    const { transport, calls } = makeLoginTransport();
    setInstagramLoginTransportForTesting(transport);

    const res = await callback({ code: 'the-code', state: await mintState() });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('connected=instagram');

    const account = await prisma.channelAccount.findFirst({
      where: { companyId: acme.company.id, providerKey: 'instagram' },
    });
    expect(account).not.toBeNull();
    // Keyed by the id Meta puts in `entry[].id`, not the app-scoped `id`:
    // storing the wrong one yields a channel that sends but never receives.
    expect(account!.externalAccountId).toBe(IG_USER_ID);
    expect(account!.displayName).toBe(`@${IG_USERNAME}`);
    // No Facebook Page is involved in this model.
    expect(account!.externalPageId).toBeNull();

    // The exchange happened at Instagram's auth host, form-encoded.
    const exchange = calls.find((c) =>
      c.url.includes('api.instagram.com/oauth/access_token'),
    );
    expect(exchange?.method).toBe('POST');
    expect(exchange?.form?.grant_type).toBe('authorization_code');
    expect(exchange?.form?.code).toBe('the-code');

    // And the account was actually subscribed — via `me`, on graph.instagram.com.
    const sub = providerCalls.find(
      (c) => c.method === 'POST' && c.url.includes('/subscribed_apps'),
    );
    expect(sub).toBeDefined();
    expect(sub!.url).toContain('graph.instagram.com');
    expect(sub!.url).toContain('/me/subscribed_apps');
  });

  it('stores the LONG-lived token and the Instagram app secret', async () => {
    setInstagramLoginTransportForTesting(makeLoginTransport().transport);
    await callback({ code: 'c', state: await mintState() });

    const account = await prisma.channelAccount.findFirstOrThrow({
      where: { companyId: acme.company.id, providerKey: 'instagram' },
    });
    const creds = (await channelCredentialsService.load(
      acme.company.id,
      account.id,
    )) as { accessToken: string; appSecret: string; verifyToken: string };

    // The short-lived token expires in an hour — storing it would mean the
    // channel dies quietly long after anyone is watching.
    expect(creds.accessToken).toBe(LONG_TOKEN);
    expect(creds.accessToken).not.toBe(SHORT_TOKEN);
    // Webhooks for this model are signed with the INSTAGRAM secret.
    expect(creds.appSecret).toBe(IGL.appSecret);
    expect(creds.verifyToken).toBeTruthy();
  });

  it('subscribes with the long-lived token, not the short-lived one', async () => {
    setInstagramLoginTransportForTesting(makeLoginTransport().transport);
    await callback({ code: 'c', state: await mintState() });
    expect(providerCalls.length).toBeGreaterThan(0);
    expect(providerCalls.every((c) => c.accessToken === LONG_TOKEN)).toBe(true);
  });

  it('accepts the flat token response shape as well as the data[] envelope', async () => {
    const { transport } = makeLoginTransport({
      exchange: () => ({
        status: 200,
        ok: true,
        json: { access_token: SHORT_TOKEN, user_id: Number(IG_USER_ID) },
      }),
    });
    setInstagramLoginTransportForTesting(transport);

    const res = await callback({ code: 'c', state: await mintState() });
    expect(res.headers.location).toContain('connected=instagram');
    const account = await prisma.channelAccount.findFirstOrThrow({
      where: { companyId: acme.company.id, providerKey: 'instagram' },
    });
    expect(account.externalAccountId).toBe(IG_USER_ID);
  });

  it('never stores secrets in readable form or leaks them in the redirect', async () => {
    setInstagramLoginTransportForTesting(makeLoginTransport().transport);
    const res = await callback({ code: 'c', state: await mintState() });
    expect(res.headers.location).not.toContain(LONG_TOKEN);
    expect(res.headers.location).not.toContain(IGL.appSecret);

    const account = await prisma.channelAccount.findFirstOrThrow({
      where: { companyId: acme.company.id, providerKey: 'instagram' },
    });
    const cred = await prisma.channelCredential.findFirstOrThrow({
      where: { channelAccountId: account.id },
    });
    expect(cred.encryptedPayload).not.toContain(LONG_TOKEN);
    expect(cred.encryptedPayload).not.toContain(IGL.appSecret);
  });

  it('connects into the tenant named by the state, not any other', async () => {
    setInstagramLoginTransportForTesting(makeLoginTransport().transport);
    await callback({ code: 'c', state: await mintState(globex.tokens.owner) });

    expect(
      await prisma.channelAccount.count({
        where: { companyId: globex.company.id, providerKey: 'instagram' },
      }),
    ).toBe(1);
    expect(
      await prisma.channelAccount.count({
        where: { companyId: acme.company.id, providerKey: 'instagram' },
      }),
    ).toBe(0);
  });
});

describe('Instagram Login — callback failures', () => {
  beforeEach(() => configure());

  it('a denied authorization redirects with ACCESS_DENIED and connects nothing', async () => {
    const res = await callback({ error: 'access_denied', state: 'x' });
    expect(res.headers.location).toContain('connect_error=ACCESS_DENIED');
    expect(await prisma.channelAccount.count()).toBe(0);
  });

  it('a failed code exchange redirects with TOKEN_EXCHANGE_FAILED', async () => {
    const { transport } = makeLoginTransport({
      exchange: () => ({ status: 400, ok: false, json: { error: 'bad code' } }),
    });
    setInstagramLoginTransportForTesting(transport);
    const res = await callback({ code: 'c', state: await mintState() });
    expect(res.headers.location).toContain('connect_error=TOKEN_EXCHANGE_FAILED');
    expect(await prisma.channelAccount.count()).toBe(0);
  });

  it('a failed long-lived upgrade connects NOTHING rather than storing a 1-hour token', async () => {
    const { transport } = makeLoginTransport({
      longLived: () => ({ status: 400, ok: false, json: { error: 'nope' } }),
    });
    setInstagramLoginTransportForTesting(transport);
    const res = await callback({ code: 'c', state: await mintState() });
    expect(res.headers.location).toContain('connect_error=TOKEN_EXCHANGE_FAILED');
    expect(await prisma.channelAccount.count()).toBe(0);
  });

  it('an unidentifiable account redirects with NO_INSTAGRAM_ACCOUNT', async () => {
    const { transport } = makeLoginTransport({
      exchange: () => ({
        status: 200,
        ok: true,
        json: { data: [{ access_token: SHORT_TOKEN }] },
      }),
      me: () => ({ status: 200, ok: true, json: { username: IG_USERNAME } }),
    });
    setInstagramLoginTransportForTesting(transport);
    const res = await callback({ code: 'c', state: await mintState() });
    expect(res.headers.location).toContain('connect_error=NO_INSTAGRAM_ACCOUNT');
    expect(await prisma.channelAccount.count()).toBe(0);
  });

  it('reconnecting the same account reports ALREADY_CONNECTED', async () => {
    setInstagramLoginTransportForTesting(makeLoginTransport().transport);
    await callback({ code: 'c', state: await mintState() });
    const again = await callback({ code: 'c2', state: await mintState() });
    expect(again.headers.location).toContain('connect_error=ALREADY_CONNECTED');
    expect(
      await prisma.channelAccount.count({ where: { providerKey: 'instagram' } }),
    ).toBe(1);
  });

  it('a missing code or state never reaches Instagram at all', async () => {
    const { transport, calls } = makeLoginTransport();
    setInstagramLoginTransportForTesting(transport);
    const res = await callback({ code: 'c' });
    expect(res.headers.location).toContain('connect_error=INVALID_STATE');
    expect(calls).toHaveLength(0);
  });

  it('a subscription failure still leaves the channel connected', async () => {
    // The credentials are already valid and encrypted; discarding them because
    // one follow-up call failed would lose real work. The gap surfaces through
    // inbound readiness instead.
    setInstagramLoginTransportForTesting(makeLoginTransport().transport);
    setInstagramTransportForTesting({
      async request(input) {
        if (input.url.includes('/subscribed_apps')) {
          return { status: 403, ok: false, json: { error: { code: 200 } } };
        }
        return { status: 200, ok: true, json: { id: IG_USER_ID } };
      },
    });
    const res = await callback({ code: 'c', state: await mintState() });
    expect(res.headers.location).toContain('connected=instagram');
    expect(
      await prisma.channelAccount.count({ where: { providerKey: 'instagram' } }),
    ).toBe(1);
  });
});
