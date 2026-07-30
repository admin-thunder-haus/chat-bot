import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../../config/env';
import { AppError } from '../../../utils/AppError';
import { logger } from '../../../utils/logger';
import { channelsService } from '../channels.service';
import { channelHealthService } from '../channel-health.service';
import { instagramApiClient } from '../providers/instagram/instagram-api-client';
import { instagramLoginGraphClient } from './instagram-login.graph';
import type { ChannelAccountView } from '../channels.types';

/**
 * One-click Instagram connect via "Instagram API with Instagram Login".
 *
 * WHY THIS EXISTS SEPARATELY FROM THE META OAUTH FLOW. Meta ships two Instagram
 * messaging models and they are not interchangeable. The Facebook-Login model
 * discovers Instagram through a linked Page and issues a Page token — but that
 * setup does not support the `messages` webhook field AT ALL, so a channel
 * connected that way can never receive a DM no matter which permissions are
 * granted. Instagram Login is the model that can: it authorizes one Instagram
 * professional account directly, issues an Instagram User token served by
 * graph.instagram.com, and delivers `messages` webhooks signed with the
 * Instagram App Secret. Our Instagram provider — its API client, normalizer and
 * signature check — was already written against that model; this flow is what
 * finally feeds it credentials of the matching kind.
 *
 * ASSET SELECTION. The picker contract ("more than one eligible asset means
 * connect nothing and let the operator choose") is not weakened here: Business
 * Login authorizes exactly ONE Instagram account per authorization, so there is
 * never a second candidate to choose between. The ambiguity the picker exists
 * to prevent cannot arise, rather than being assumed away.
 */

/** Signed state lives at most 10 minutes (start -> callback round-trip). */
export const INSTAGRAM_LOGIN_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Scopes for messaging. `instagram_business_basic` identifies the account and
 * `instagram_business_manage_messages` reads and sends DMs; the older
 * un-prefixed spellings (`business_basic`, …) were retired by Meta.
 */
export const INSTAGRAM_LOGIN_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
].join(',');

// ---------------------------------------------------------------------------
// Config (read lazily so tests can toggle configured/unconfigured states).
// ---------------------------------------------------------------------------

export interface InstagramLoginConfig {
  appId?: string;
  appSecret?: string;
  frontendUrl: string;
}

let configOverridesForTesting: Partial<InstagramLoginConfig> | null = null;

/** Test hook: override the env-derived config (null restores env values). */
export function setInstagramLoginConfigForTesting(
  overrides: Partial<InstagramLoginConfig> | null,
): void {
  configOverridesForTesting = overrides;
}

function readConfig(): InstagramLoginConfig {
  const base: InstagramLoginConfig = {
    appId: env.INSTAGRAM_APP_ID,
    appSecret: env.INSTAGRAM_APP_SECRET,
    frontendUrl: env.FRONTEND_APP_URL,
  };
  return configOverridesForTesting
    ? { ...base, ...configOverridesForTesting }
    : base;
}

// ---------------------------------------------------------------------------
// Signed state (HMAC over base64url JSON — no server-side session storage).
// ---------------------------------------------------------------------------

/**
 * Domain separation tag. Without it a state minted for one flow would verify in
 * the other, and a browser returning from Instagram could be walked through the
 * Facebook-Page discovery path (or vice versa) — a confusing failure at best.
 */
const STATE_CONTEXT = 'instagram-login.v1';

export interface InstagramLoginState {
  companyId: string;
  userId: string;
  nonce: string;
  iat: number;
}

function stateHmac(payload: string): string {
  return createHmac('sha256', env.JWT_ACCESS_SECRET)
    .update(`${STATE_CONTEXT}.${payload}`)
    .digest('base64url');
}

/** Sign the OAuth state: `base64url(json).base64url(hmac)`. */
export function signInstagramLoginState(state: InstagramLoginState): string {
  const payload = Buffer.from(JSON.stringify(state), 'utf8').toString(
    'base64url',
  );
  return `${payload}.${stateHmac(payload)}`;
}

/**
 * Verify a state string: signature (constant-time), shape, and TTL. Returns
 * null on ANY failure — the callback maps that to a safe redirect error code.
 */
export function verifyInstagramLoginState(
  raw: string,
  ttlMs: number = INSTAGRAM_LOGIN_STATE_TTL_MS,
): InstagramLoginState | null {
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(stateHmac(payload));
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as Partial<InstagramLoginState>;
    if (
      typeof parsed.companyId !== 'string' ||
      typeof parsed.userId !== 'string' ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.iat !== 'number'
    ) {
      return null;
    }
    const age = Date.now() - parsed.iat;
    if (age < 0 || age > ttlMs) return null;
    return parsed as InstagramLoginState;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Flow errors — safe, machine-readable codes only (never tokens/messages).
// ---------------------------------------------------------------------------

class InstagramFlowError extends Error {
  constructor(public readonly safeCode: string) {
    super(safeCode);
    this.name = 'InstagramFlowError';
  }
}

function toSafeRedirectCode(err: unknown): string {
  if (err instanceof InstagramFlowError) return err.safeCode;
  if (err instanceof AppError && err.statusCode === 409) {
    return 'ALREADY_CONNECTED';
  }
  return 'CONNECT_FAILED';
}

export function instagramLoginCallbackUrl(publicBaseUrl: string): string {
  return `${publicBaseUrl}/api/v1/channels/oauth/instagram-login/callback`;
}

function notConfigured(): AppError {
  return AppError.conflict(
    'Instagram Login is not configured for this deployment',
    [],
    'OAUTH_NOT_CONFIGURED',
  );
}

// ---------------------------------------------------------------------------
// Public service surface.
// ---------------------------------------------------------------------------

export const instagramLoginService = {
  /** Safe status for the dashboard — the app id is public, the secret never. */
  getStatus(): { configured: boolean; appId: string | null } {
    const cfg = readConfig();
    return {
      configured: Boolean(cfg.appId && cfg.appSecret),
      appId: cfg.appId ?? null,
    };
  },

  /**
   * Build the Business Login authorize URL. The tenant identity travels in the
   * signed state (verified on callback) — never as plain data the callback
   * would have to trust.
   */
  startFlow(
    companyId: string,
    userId: string,
    publicBaseUrl: string,
  ): { url: string } {
    const cfg = readConfig();
    if (!cfg.appId || !cfg.appSecret) throw notConfigured();

    const state = signInstagramLoginState({
      companyId,
      userId,
      nonce: randomBytes(12).toString('hex'),
      iat: Date.now(),
    });
    const url = new URL('https://www.instagram.com/oauth/authorize');
    url.searchParams.set('client_id', cfg.appId);
    url.searchParams.set('redirect_uri', instagramLoginCallbackUrl(publicBaseUrl));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', INSTAGRAM_LOGIN_SCOPES);
    url.searchParams.set('state', state);
    return { url: url.toString() };
  },

  /**
   * Handle the OAuth redirect callback. PUBLIC (the browser arrives without our
   * JWT) — the signed state carries and authenticates the tenant. It NEVER
   * throws: every outcome becomes a redirect back to the dashboard with either
   * ?connected=instagram or ?connect_error=<safe_code>, never a token and never
   * a raw provider error.
   */
  async handleCallback(
    query: Record<string, unknown>,
    publicBaseUrl: string,
  ): Promise<string> {
    const cfg = readConfig();
    const base = `${cfg.frontendUrl}/dashboard/channels`;
    const fail = (code: string): string =>
      `${base}?connect_error=${encodeURIComponent(code)}`;

    if (!cfg.appId || !cfg.appSecret) return fail('OAUTH_NOT_CONFIGURED');
    // User cancelled or denied in Instagram's dialog.
    if (typeof query.error === 'string' && query.error) {
      return fail('ACCESS_DENIED');
    }
    const code = typeof query.code === 'string' ? query.code : '';
    const rawState = typeof query.state === 'string' ? query.state : '';
    if (!code || !rawState) return fail('INVALID_STATE');
    const state = verifyInstagramLoginState(rawState);
    if (!state) return fail('INVALID_STATE');

    try {
      await connectAuthorizedAccount({
        companyId: state.companyId,
        userId: state.userId,
        // Instagram appends a `#_` fragment to the redirect. A browser drops it
        // before the request reaches us, but anything relaying the URL verbatim
        // does not, and the trailing characters would invalidate the code.
        code: code.replace(/#_$/, ''),
        redirectUri: instagramLoginCallbackUrl(publicBaseUrl),
        cfg,
      });
      return `${base}?connected=instagram`;
    } catch (err) {
      const safeCode = toSafeRedirectCode(err);
      logger.warn('instagram_login.callback.failed', {
        companyId: state.companyId,
        code: safeCode,
      });
      return fail(safeCode);
    }
  },
};

/**
 * Exchange the code and connect the single authorized Instagram account.
 *
 * Hands off to the SAME connect path the manual form uses, so credential
 * encryption, duplicate detection, activity logging and health checks are
 * identical in both flows.
 */
async function connectAuthorizedAccount(input: {
  companyId: string;
  userId: string;
  code: string;
  redirectUri: string;
  cfg: InstagramLoginConfig;
}): Promise<ChannelAccountView> {
  const { cfg } = input;

  const short = await instagramLoginGraphClient.exchangeCode({
    appId: cfg.appId!,
    appSecret: cfg.appSecret!,
    code: input.code,
    redirectUri: input.redirectUri,
  });
  if (!short.ok || !short.accessToken) {
    throw new InstagramFlowError('TOKEN_EXCHANGE_FAILED');
  }

  // A short-lived token expires in an hour; upgrade before storing anything.
  const long = await instagramLoginGraphClient.exchangeLongLivedToken({
    appSecret: cfg.appSecret!,
    shortLivedToken: short.accessToken,
  });
  if (!long.ok || !long.accessToken) {
    throw new InstagramFlowError('TOKEN_EXCHANGE_FAILED');
  }
  const accessToken = long.accessToken;

  // `me` resolves from the token itself, so it identifies exactly the account
  // this authorization granted — an id can never be smuggled in from outside.
  const me = await instagramLoginGraphClient.getMe({ accessToken });
  const instagramAccountId = me.userId ?? short.userId;
  if (!instagramAccountId) {
    throw new InstagramFlowError('NO_INSTAGRAM_ACCOUNT');
  }

  const account = await channelsService.connectCredentialedProvider(
    input.companyId,
    input.userId,
    'instagram',
    me.username ? `@${me.username}` : 'Instagram',
    {
      instagramAccountId,
      instagramUsername: me.username,
      accessToken,
      // The INSTAGRAM app secret — webhooks for this model are signed with it,
      // not with the Facebook app secret.
      appSecret: cfg.appSecret!,
      verifyToken: randomBytes(24).toString('hex'),
    },
  );

  // Both post-connect steps are non-fatal: the account already exists with
  // encrypted credentials, so a failure here is surfaced through the channel's
  // connection state and inbound readiness rather than by discarding the work.
  try {
    await channelHealthService.runHealthCheck(
      input.companyId,
      account.id,
      input.userId,
    );
  } catch (err) {
    logger.warn('instagram_login.health_check.failed', {
      channelAccountId: account.id,
      error: err instanceof Error ? err.message : 'unknown',
    });
  }

  // Without this the callback URL is configured but THIS account never posts to
  // it: the channel connects, looks healthy, sends fine, and receives nothing.
  const sub = await instagramApiClient.subscribeApp({
    accessToken,
    nodeId: 'me',
    subscribedFields: 'messages',
  });
  if (!sub.ok) {
    logger.warn('instagram_login.subscribe_app.failed', {
      channelAccountId: account.id,
      detail: sub.detail,
    });
  }

  return account;
}
