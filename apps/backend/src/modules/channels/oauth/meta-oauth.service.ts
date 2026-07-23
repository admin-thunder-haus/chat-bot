import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../../config/env';
import { AppError } from '../../../utils/AppError';
import { logger } from '../../../utils/logger';
import { channelsService } from '../channels.service';
import { channelHealthService } from '../channel-health.service';
import { metaOauthGraphClient } from './meta-oauth.graph';
import type { ChannelAccountView } from '../channels.types';

/**
 * Meta OAuth / Embedded Signup service — the one-click alternative to the
 * manual connect forms. It drives the browser through Meta's OAuth dialog,
 * exchanges the returned code for tokens, discovers the asset ids (Page /
 * Instagram account / WABA + phone number) and then hands off to the SAME
 * connect path the manual flow uses (channelsService.connectCredentialedProvider),
 * so credential encryption, duplicate detection, activity logging and health
 * checks are identical in both flows.
 *
 * v1 limitation (documented): when the user grants access to multiple Facebook
 * Pages, the FIRST page returned by /me/accounts is connected. Reconnect with
 * a single page selected in the Meta dialog to target a specific one.
 */

export type MetaOauthProvider = 'facebook' | 'instagram' | 'whatsapp';

const META_PROVIDERS: readonly MetaOauthProvider[] = [
  'facebook',
  'instagram',
  'whatsapp',
];

/** Signed state lives at most 10 minutes (start → callback round-trip). */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Config (read lazily so tests can toggle configured/unconfigured states).
// ---------------------------------------------------------------------------

export interface MetaOauthConfig {
  appId?: string;
  appSecret?: string;
  graphVersion: string;
  whatsappConfigId?: string;
  loginConfigId?: string;
  frontendUrl: string;
}

let configOverridesForTesting: Partial<MetaOauthConfig> | null = null;

/** Test hook: override the env-derived config (null restores env values). */
export function setMetaOauthConfigForTesting(
  overrides: Partial<MetaOauthConfig> | null,
): void {
  configOverridesForTesting = overrides;
}

function readConfig(): MetaOauthConfig {
  const base: MetaOauthConfig = {
    appId: env.META_APP_ID,
    appSecret: env.META_APP_SECRET,
    graphVersion: env.META_GRAPH_API_VERSION,
    whatsappConfigId: env.WHATSAPP_ES_CONFIG_ID,
    loginConfigId: env.META_LOGIN_CONFIG_ID,
    frontendUrl: env.FRONTEND_APP_URL,
  };
  return configOverridesForTesting
    ? { ...base, ...configOverridesForTesting }
    : base;
}

// ---------------------------------------------------------------------------
// Signed state (HMAC over base64url JSON — no server-side session storage).
// ---------------------------------------------------------------------------

export interface MetaOauthState {
  companyId: string;
  userId: string;
  provider: MetaOauthProvider;
  nonce: string;
  iat: number;
}

function stateHmac(payload: string): string {
  return createHmac('sha256', env.JWT_ACCESS_SECRET)
    .update(payload)
    .digest('base64url');
}

/** Sign the OAuth state: `base64url(json).base64url(hmac)`. */
export function signOauthState(state: MetaOauthState): string {
  const payload = Buffer.from(JSON.stringify(state), 'utf8').toString(
    'base64url',
  );
  return `${payload}.${stateHmac(payload)}`;
}

/**
 * Verify a state string: signature (constant-time), shape, and TTL. Returns
 * null on ANY failure — the callback maps that to a safe redirect error code.
 */
export function verifyOauthState(
  raw: string,
  ttlMs: number = OAUTH_STATE_TTL_MS,
): MetaOauthState | null {
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  const expected = stateHmac(payload);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as Partial<MetaOauthState>;
    if (
      typeof parsed.companyId !== 'string' ||
      typeof parsed.userId !== 'string' ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.iat !== 'number' ||
      !META_PROVIDERS.includes(parsed.provider as MetaOauthProvider)
    ) {
      return null;
    }
    const age = Date.now() - parsed.iat;
    if (age < 0 || age > ttlMs) return null;
    return parsed as MetaOauthState;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Flow errors — safe, machine-readable codes only (never tokens/messages).
// ---------------------------------------------------------------------------

class MetaFlowError extends Error {
  constructor(public readonly safeCode: string) {
    super(safeCode);
    this.name = 'MetaFlowError';
  }
}

const FLOW_ERROR_MESSAGES: Record<string, string> = {
  TOKEN_EXCHANGE_FAILED:
    'Could not exchange the Meta authorization code for an access token',
  NO_PAGES: 'No Facebook Pages were shared during the Meta authorization',
  NO_INSTAGRAM_ACCOUNT:
    'The shared Facebook Page has no linked Instagram business account',
  NO_WABA:
    'No WhatsApp Business Account was shared during the Meta signup',
  NO_PHONE_NUMBER:
    'The WhatsApp Business Account has no registered phone numbers',
};

function toSafeRedirectCode(err: unknown): string {
  if (err instanceof MetaFlowError) return err.safeCode;
  if (err instanceof AppError && err.statusCode === 409) {
    return 'ALREADY_CONNECTED';
  }
  return 'CONNECT_FAILED';
}

function callbackUrl(publicBaseUrl: string): string {
  return `${publicBaseUrl}/api/v1/channels/oauth/meta/callback`;
}

function newVerifyToken(): string {
  return randomBytes(24).toString('hex');
}

/**
 * Post-connect steps shared by every provider: validate the credentials with
 * the standard health check (same as the manual flow) and subscribe our app
 * to the node's webhooks. BOTH are non-fatal — the account is already
 * connected with encrypted credentials; failures are logged and surfaced via
 * the channel's connection state / docs, never by aborting the flow.
 */
async function finalizeConnection(input: {
  companyId: string;
  userId: string;
  accountId: string;
  provider: MetaOauthProvider;
  subscribeNodeId: string;
  subscribeAccessToken: string;
  subscribedFields?: string;
  graphVersion: string;
}): Promise<void> {
  try {
    await channelHealthService.runHealthCheck(
      input.companyId,
      input.accountId,
      input.userId,
    );
  } catch (err) {
    logger.warn('meta_oauth.health_check.failed', {
      provider: input.provider,
      channelAccountId: input.accountId,
      error: err instanceof Error ? err.message : 'unknown',
    });
  }
  const sub = await metaOauthGraphClient.subscribeApp({
    version: input.graphVersion,
    accessToken: input.subscribeAccessToken,
    nodeId: input.subscribeNodeId,
    subscribedFields: input.subscribedFields,
  });
  if (!sub.ok) {
    logger.warn('meta_oauth.subscribe_app.failed', {
      provider: input.provider,
      channelAccountId: input.accountId,
    });
  }
}

// ---------------------------------------------------------------------------
// Provider-specific connect steps (all reuse the existing connect service).
// ---------------------------------------------------------------------------

async function connectPageProvider(input: {
  companyId: string;
  userId: string;
  provider: 'facebook' | 'instagram';
  code: string;
  redirectUri: string;
  cfg: MetaOauthConfig;
}): Promise<ChannelAccountView> {
  const { cfg } = input;
  const exchange = await metaOauthGraphClient.exchangeCode({
    version: cfg.graphVersion,
    appId: cfg.appId!,
    appSecret: cfg.appSecret!,
    code: input.code,
    redirectUri: input.redirectUri,
  });
  if (!exchange.ok || !exchange.accessToken) {
    throw new MetaFlowError('TOKEN_EXCHANGE_FAILED');
  }

  const pagesRes = await metaOauthGraphClient.getPages({
    version: cfg.graphVersion,
    accessToken: exchange.accessToken,
  });
  if (!pagesRes.ok || pagesRes.pages.length === 0) {
    throw new MetaFlowError('NO_PAGES');
  }
  // v1 limitation: the FIRST granted page is connected (documented above).
  const page = pagesRes.pages[0];
  if (!page.id || !page.access_token) {
    throw new MetaFlowError('TOKEN_EXCHANGE_FAILED');
  }

  const verifyToken = newVerifyToken();
  let account: ChannelAccountView;
  if (input.provider === 'facebook') {
    // Same payload shape as the manual POST /channels/facebook/connect flow.
    account = await channelsService.connectCredentialedProvider(
      input.companyId,
      input.userId,
      'facebook',
      page.name ?? 'Facebook Messenger',
      {
        pageId: page.id,
        pageName: page.name,
        accessToken: page.access_token,
        appSecret: cfg.appSecret!,
        verifyToken,
      },
    );
  } else {
    const instagramAccountId = page.instagram_business_account?.id;
    if (!instagramAccountId) {
      throw new MetaFlowError('NO_INSTAGRAM_ACCOUNT');
    }
    // Same payload shape as the manual POST /channels/instagram/connect flow.
    account = await channelsService.connectCredentialedProvider(
      input.companyId,
      input.userId,
      'instagram',
      page.name ?? 'Instagram',
      {
        instagramAccountId,
        facebookPageId: page.id,
        accessToken: page.access_token,
        appSecret: cfg.appSecret!,
        verifyToken,
      },
    );
  }

  await finalizeConnection({
    companyId: input.companyId,
    userId: input.userId,
    accountId: account.id,
    provider: input.provider,
    subscribeNodeId: page.id,
    subscribeAccessToken: page.access_token,
    subscribedFields: 'messages',
    graphVersion: cfg.graphVersion,
  });
  return account;
}

async function connectWhatsAppFromCode(input: {
  companyId: string;
  userId: string;
  code: string;
  /** Present for the redirect flow; absent for the JS-SDK popup variant. */
  redirectUri?: string;
  phoneNumberId?: string;
  wabaId?: string;
  cfg: MetaOauthConfig;
}): Promise<ChannelAccountView> {
  const { cfg } = input;
  const exchange = await metaOauthGraphClient.exchangeCode({
    version: cfg.graphVersion,
    appId: cfg.appId!,
    appSecret: cfg.appSecret!,
    code: input.code,
    redirectUri: input.redirectUri,
  });
  if (!exchange.ok || !exchange.accessToken) {
    throw new MetaFlowError('TOKEN_EXCHANGE_FAILED');
  }
  const businessToken = exchange.accessToken;

  // WABA id: prefer the one shared by the popup; otherwise read the granular
  // scopes granted to the business token via /debug_token.
  let wabaId = input.wabaId;
  if (!wabaId) {
    const dbg = await metaOauthGraphClient.debugToken({
      version: cfg.graphVersion,
      appId: cfg.appId!,
      appSecret: cfg.appSecret!,
      inputToken: businessToken,
    });
    const scope = dbg.granularScopes.find(
      (s) =>
        (s.scope === 'whatsapp_business_management' ||
          s.scope === 'whatsapp_business_messaging') &&
        Array.isArray(s.target_ids) &&
        s.target_ids.length > 0,
    );
    wabaId = scope?.target_ids?.[0];
  }
  if (!wabaId) throw new MetaFlowError('NO_WABA');

  let phoneNumberId = input.phoneNumberId;
  let displayPhoneNumber: string | undefined;
  let verifiedName: string | undefined;
  if (!phoneNumberId) {
    const phones = await metaOauthGraphClient.getPhoneNumbers({
      version: cfg.graphVersion,
      accessToken: businessToken,
      wabaId,
    });
    const first = phones.phones[0];
    if (!phones.ok || !first?.id) throw new MetaFlowError('NO_PHONE_NUMBER');
    phoneNumberId = first.id;
    displayPhoneNumber = first.display_phone_number;
    verifiedName = first.verified_name;
  }

  // Same payload shape as the manual POST /channels/whatsapp/connect flow.
  const account = await channelsService.connectCredentialedProvider(
    input.companyId,
    input.userId,
    'whatsapp',
    verifiedName ?? 'WhatsApp',
    {
      phoneNumberId,
      wabaId,
      displayPhoneNumber,
      businessName: verifiedName,
      accessToken: businessToken,
      appSecret: cfg.appSecret!,
      verifyToken: newVerifyToken(),
    },
  );

  await finalizeConnection({
    companyId: input.companyId,
    userId: input.userId,
    accountId: account.id,
    provider: 'whatsapp',
    subscribeNodeId: wabaId,
    subscribeAccessToken: businessToken,
    graphVersion: cfg.graphVersion,
  });
  return account;
}

// ---------------------------------------------------------------------------
// Public service surface.
// ---------------------------------------------------------------------------

export const metaOauthService = {
  /** Safe status for the dashboard — config ids are public, secrets never. */
  getStatus(): {
    configured: boolean;
    appId: string | null;
    whatsappConfigId: string | null;
    loginConfigId: string | null;
  } {
    const cfg = readConfig();
    return {
      configured: Boolean(cfg.appId && cfg.appSecret),
      appId: cfg.appId ?? null,
      whatsappConfigId: cfg.whatsappConfigId ?? null,
      loginConfigId: cfg.loginConfigId ?? null,
    };
  },

  /**
   * Build the Meta authorize URL for the given provider. The tenant identity
   * travels in the signed state (verified on callback) — never in the URL as
   * plain data the callback would trust.
   */
  startFlow(
    companyId: string,
    userId: string,
    provider: MetaOauthProvider,
    publicBaseUrl: string,
  ): { url: string } {
    const cfg = readConfig();
    const configId =
      provider === 'whatsapp' ? cfg.whatsappConfigId : cfg.loginConfigId;
    if (!cfg.appId || !cfg.appSecret || !configId) {
      throw AppError.conflict(
        'Meta OAuth is not configured for this deployment',
        [],
        'OAUTH_NOT_CONFIGURED',
      );
    }
    const state = signOauthState({
      companyId,
      userId,
      provider,
      nonce: randomBytes(12).toString('hex'),
      iat: Date.now(),
    });
    const url = new URL(
      `https://www.facebook.com/${cfg.graphVersion}/dialog/oauth`,
    );
    url.searchParams.set('client_id', cfg.appId);
    url.searchParams.set('redirect_uri', callbackUrl(publicBaseUrl));
    url.searchParams.set('state', state);
    url.searchParams.set('config_id', configId);
    url.searchParams.set('response_type', 'code');
    return { url: url.toString() };
  },

  /**
   * Handle the OAuth redirect callback. This endpoint is PUBLIC (the browser
   * arrives without our JWT) — the signed state carries and authenticates the
   * tenant. It NEVER throws: every outcome becomes a 302 redirect back to the
   * dashboard with either ?connected=<provider> or ?connect_error=<safe_code>
   * (never tokens, never raw error messages).
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
    // User cancelled / denied in the Meta dialog.
    if (typeof query.error === 'string' && query.error) {
      return fail('ACCESS_DENIED');
    }
    const code = typeof query.code === 'string' ? query.code : '';
    const rawState = typeof query.state === 'string' ? query.state : '';
    if (!code || !rawState) return fail('INVALID_STATE');
    const state = verifyOauthState(rawState);
    if (!state) return fail('INVALID_STATE');

    try {
      const redirectUri = callbackUrl(publicBaseUrl);
      if (state.provider === 'whatsapp') {
        await connectWhatsAppFromCode({
          companyId: state.companyId,
          userId: state.userId,
          code,
          redirectUri,
          cfg,
        });
      } else {
        await connectPageProvider({
          companyId: state.companyId,
          userId: state.userId,
          provider: state.provider,
          code,
          redirectUri,
          cfg,
        });
      }
      return `${base}?connected=${encodeURIComponent(state.provider)}`;
    } catch (err) {
      const safeCode = toSafeRedirectCode(err);
      logger.warn('meta_oauth.callback.failed', {
        provider: state.provider,
        companyId: state.companyId,
        code: safeCode,
      });
      return fail(safeCode);
    }
  },

  /**
   * JS-SDK Embedded Signup completion (popup variant): the frontend receives
   * { code, phone_number_id, waba_id } via postMessage and posts them here on
   * an AUTHENTICATED route. Same exchange + connect path, JSON response.
   */
  async completeWhatsApp(
    companyId: string,
    userId: string,
    input: { code: string; phoneNumberId?: string; wabaId?: string },
  ): Promise<ChannelAccountView> {
    const cfg = readConfig();
    if (!cfg.appId || !cfg.appSecret) {
      throw AppError.conflict(
        'Meta OAuth is not configured for this deployment',
        [],
        'OAUTH_NOT_CONFIGURED',
      );
    }
    try {
      return await connectWhatsAppFromCode({
        companyId,
        userId,
        code: input.code,
        phoneNumberId: input.phoneNumberId,
        wabaId: input.wabaId,
        cfg,
      });
    } catch (err) {
      if (err instanceof MetaFlowError) {
        throw AppError.badRequest(
          FLOW_ERROR_MESSAGES[err.safeCode] ?? 'Meta connection failed',
          [],
          err.safeCode,
        );
      }
      throw err;
    }
  },
};
