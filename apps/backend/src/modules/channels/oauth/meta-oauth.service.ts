import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../../../config/env';
import { AppError } from '../../../utils/AppError';
import { logger } from '../../../utils/logger';
import { channelsService } from '../channels.service';
import { channelHealthService } from '../channel-health.service';
import { metaOauthGraphClient } from './meta-oauth.graph';
import { whatsAppApiClient } from '../providers/whatsapp/whatsapp-api.client';
import {
  metaOauthSelectionStore,
  selectionNotFound,
  toClientView,
  type LoadedSelection,
  type SelectionView,
  type StoredPageAsset,
  type StoredWabaAsset,
} from './meta-oauth.selection';
import {
  isMetaOauthProvider,
  type MetaOauthProvider,
} from './meta-oauth.types';
import type { ChannelAccountView } from '../channels.types';

/**
 * Meta OAuth / Embedded Signup service — the one-click alternative to the
 * manual connect forms. It drives the browser through Meta's OAuth dialog,
 * exchanges the returned code for tokens, discovers the available assets
 * (Pages / Instagram professional accounts / WABAs + phone numbers) and hands
 * off to the SAME connect path the manual flow uses
 * (channelsService.connectCredentialedProvider), so credential encryption,
 * duplicate detection, activity logging and health checks are identical in
 * both flows. The manual forms are untouched by any of this.
 *
 * ASSET SELECTION. An authorization frequently grants more than one eligible
 * asset — an agency with ten client Pages, a business with two WABAs, a WABA
 * with several numbers. Connecting the first one returned by Graph is a guess,
 * and a wrong guess here is expensive: it wires a live customer channel to the
 * wrong brand, and the operator may not notice until a customer message lands
 * in the wrong inbox. So the flow now:
 *
 *   1 eligible asset  -> connect it (the common case stays one click)
 *   2+ eligible       -> park the assets ENCRYPTED and send the operator to a
 *                        picker; connect only what they explicitly choose
 *   0 eligible        -> the same safe NO_PAGES / NO_WABA codes as before
 */

export type { MetaOauthProvider } from './meta-oauth.types';

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
      !isMetaOauthProvider(parsed.provider)
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
  constructor(
    public readonly safeCode: string,
    /** Meta's own explanation, when it gave one — shown to the operator. */
    public readonly detail?: string,
  ) {
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
 * Six digits for the number's two-step verification PIN.
 *
 * Random rather than fixed: it is a credential on the customer's own WhatsApp
 * number, and a constant baked into the platform would be the same on every
 * tenant. Not stored — Meta only needs it at registration, and a number that
 * already carries a different PIN cannot be re-registered here anyway, which
 * the failed outcome reports.
 */
function newRegistrationPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
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

/**
 * Exchange the code and list the Pages this authorization actually grants.
 *
 * For Instagram, "eligible" means the Page has a linked Instagram professional
 * account — a Page without one cannot be connected at all, so it must not be
 * offered as a choice. Filtering here rather than at the picker keeps the
 * one-asset fast path honest: a grant of five Pages where only one has
 * Instagram is genuinely unambiguous.
 */
async function discoverPageAssets(input: {
  provider: 'facebook' | 'instagram';
  code: string;
  redirectUri: string;
  cfg: MetaOauthConfig;
}): Promise<{ accessToken: string; pages: StoredPageAsset[] }> {
  const { cfg } = input;
  const exchange = await metaOauthGraphClient.exchangeCode({
    version: cfg.graphVersion,
    appId: cfg.appId!,
    appSecret: cfg.appSecret!,
    code: input.code,
    redirectUri: input.redirectUri,
  });
  if (!exchange.ok || !exchange.accessToken) {
    throw new MetaFlowError('TOKEN_EXCHANGE_FAILED', exchange.reason);
  }

  const pagesRes = await metaOauthGraphClient.getPages({
    version: cfg.graphVersion,
    accessToken: exchange.accessToken,
  });
  if (!pagesRes.ok || pagesRes.pages.length === 0) {
    throw new MetaFlowError('NO_PAGES');
  }

  const usable = pagesRes.pages.filter((p) => p.id && p.access_token);
  if (usable.length === 0) throw new MetaFlowError('TOKEN_EXCHANGE_FAILED');

  const pages: StoredPageAsset[] = usable.map((p) => ({
    pageId: p.id,
    pageName: p.name,
    pageAccessToken: p.access_token!,
    instagramAccountId: p.instagram_business_account?.id,
  }));

  if (input.provider === 'instagram') {
    const linked = pages.filter((p) => p.instagramAccountId);
    if (linked.length === 0) throw new MetaFlowError('NO_INSTAGRAM_ACCOUNT');
    return { accessToken: exchange.accessToken, pages: linked };
  }
  return { accessToken: exchange.accessToken, pages };
}

/** Connect ONE already-chosen Page (or its linked Instagram account). */
async function connectSelectedPage(input: {
  companyId: string;
  userId: string;
  provider: 'facebook' | 'instagram';
  page: StoredPageAsset;
  cfg: MetaOauthConfig;
}): Promise<ChannelAccountView> {
  const { cfg, page } = input;
  const verifyToken = newVerifyToken();
  let account: ChannelAccountView;

  if (input.provider === 'facebook') {
    // Same payload shape as the manual POST /channels/facebook/connect flow.
    account = await channelsService.connectCredentialedProvider(
      input.companyId,
      input.userId,
      'facebook',
      page.pageName ?? 'Facebook Messenger',
      {
        pageId: page.pageId,
        pageName: page.pageName,
        accessToken: page.pageAccessToken,
        appSecret: cfg.appSecret!,
        verifyToken,
      },
    );
  } else {
    if (!page.instagramAccountId) {
      throw new MetaFlowError('NO_INSTAGRAM_ACCOUNT');
    }
    // Same payload shape as the manual POST /channels/instagram/connect flow.
    account = await channelsService.connectCredentialedProvider(
      input.companyId,
      input.userId,
      'instagram',
      page.pageName ?? 'Instagram',
      {
        instagramAccountId: page.instagramAccountId,
        facebookPageId: page.pageId,
        accessToken: page.pageAccessToken,
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
    subscribeNodeId: page.pageId,
    subscribeAccessToken: page.pageAccessToken,
    subscribedFields: 'messages',
    graphVersion: cfg.graphVersion,
  });
  return account;
}

/**
 * Exchange the code and enumerate EVERY WhatsApp Business Account this
 * authorization grants, each with its registered numbers.
 *
 * The WABA ids come from the granular scopes on the business token. The old
 * code took `target_ids[0]` of the first matching scope; it now unions the
 * target_ids across both whatsapp scopes, because a business that shared two
 * WABAs is exactly the case a "pick the first" rule gets wrong.
 */
async function discoverWhatsAppAssets(input: {
  code: string;
  /** Present for the redirect flow; absent for the JS-SDK popup variant. */
  redirectUri?: string;
  cfg: MetaOauthConfig;
}): Promise<{ accessToken: string; wabas: StoredWabaAsset[] }> {
  const { cfg } = input;
  const exchange = await metaOauthGraphClient.exchangeCode({
    version: cfg.graphVersion,
    appId: cfg.appId!,
    appSecret: cfg.appSecret!,
    code: input.code,
    redirectUri: input.redirectUri,
  });
  if (!exchange.ok || !exchange.accessToken) {
    throw new MetaFlowError('TOKEN_EXCHANGE_FAILED', exchange.reason);
  }
  const businessToken = exchange.accessToken;

  const dbg = await metaOauthGraphClient.debugToken({
    version: cfg.graphVersion,
    appId: cfg.appId!,
    appSecret: cfg.appSecret!,
    inputToken: businessToken,
  });
  const wabaIds = [
    ...new Set(
      dbg.granularScopes
        .filter(
          (s) =>
            s.scope === 'whatsapp_business_management' ||
            s.scope === 'whatsapp_business_messaging',
        )
        .flatMap((s) => (Array.isArray(s.target_ids) ? s.target_ids : [])),
    ),
  ];
  if (wabaIds.length === 0) throw new MetaFlowError('NO_WABA');

  const wabas: StoredWabaAsset[] = [];
  for (const wabaId of wabaIds) {
    // Sequential: a business shares a handful of WABAs at most, and a burst of
    // parallel Graph calls buys nothing but rate-limit risk.
    /* eslint-disable no-await-in-loop */
    const phonesRes = await metaOauthGraphClient.getPhoneNumbers({
      version: cfg.graphVersion,
      accessToken: businessToken,
      wabaId,
    });
    const phones = phonesRes.phones.filter((p) => p.id);
    if (phones.length === 0) continue; // a WABA with no numbers cannot be used
    const wabaName = await metaOauthGraphClient.getWabaName({
      version: cfg.graphVersion,
      accessToken: businessToken,
      wabaId,
    });
    /* eslint-enable no-await-in-loop */
    wabas.push({
      wabaId,
      wabaName,
      phones: phones.map((p) => ({
        phoneNumberId: p.id,
        displayPhoneNumber: p.display_phone_number,
        verifiedName: p.verified_name,
      })),
    });
  }

  if (wabas.length === 0) throw new MetaFlowError('NO_PHONE_NUMBER');
  return { accessToken: businessToken, wabas };
}

/** Connect ONE already-chosen (WABA, phone number) pair. */
async function connectSelectedWhatsApp(input: {
  companyId: string;
  userId: string;
  accessToken: string;
  waba: StoredWabaAsset;
  phone: StoredWabaAsset['phones'][number];
  cfg: MetaOauthConfig;
}): Promise<ChannelAccountView> {
  const { cfg, waba, phone } = input;

  // Same payload shape as the manual POST /channels/whatsapp/connect flow.
  const account = await channelsService.connectCredentialedProvider(
    input.companyId,
    input.userId,
    'whatsapp',
    phone.verifiedName ?? waba.wabaName ?? 'WhatsApp',
    {
      phoneNumberId: phone.phoneNumberId,
      wabaId: waba.wabaId,
      displayPhoneNumber: phone.displayPhoneNumber,
      businessName: phone.verifiedName,
      accessToken: input.accessToken,
      appSecret: cfg.appSecret!,
      verifyToken: newVerifyToken(),
    },
  );

  // Meta requires the number to be REGISTERED for Cloud API use, not merely
  // shared through signup. Skipping it leaves a channel that connects, passes
  // its health check (which only proves the token works) and fails every send.
  // Non-fatal for the same reason the webhook subscription is: the credentials
  // are already valid and stored, and a failure here is reported rather than
  // used as a reason to throw them away.
  const registered = await whatsAppApiClient.registerPhoneNumber({
    accessToken: input.accessToken,
    phoneNumberId: phone.phoneNumberId,
    pin: newRegistrationPin(),
  });
  if (!registered.ok) {
    logger.warn('meta_oauth.whatsapp.register.failed', {
      channelAccountId: account.id,
      detail: registered.detail,
    });
  }

  await finalizeConnection({
    companyId: input.companyId,
    userId: input.userId,
    accountId: account.id,
    provider: 'whatsapp',
    subscribeNodeId: waba.wabaId,
    subscribeAccessToken: input.accessToken,
    graphVersion: cfg.graphVersion,
  });
  return account;
}

/**
 * Total connectable assets in a discovery result. A WABA with three numbers is
 * three choices, not one — picking the wrong number is as wrong as picking the
 * wrong WABA, so the fast path must only trigger when the whole result is a
 * single (waba, phone) pair.
 */
function countWhatsAppChoices(wabas: StoredWabaAsset[]): number {
  return wabas.reduce((n, w) => n + w.phones.length, 0);
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
      const selectUrl = (id: string): string =>
        `${base}/select?selection=${encodeURIComponent(id)}&provider=${encodeURIComponent(state.provider)}`;

      if (state.provider === 'whatsapp') {
        const { accessToken, wabas } = await discoverWhatsAppAssets({
          code,
          redirectUri,
          cfg,
        });
        // One WABA with one number is unambiguous — keep it one click.
        if (countWhatsAppChoices(wabas) === 1) {
          await connectSelectedWhatsApp({
            companyId: state.companyId,
            userId: state.userId,
            accessToken,
            waba: wabas[0],
            phone: wabas[0].phones[0],
            cfg,
          });
          return `${base}?connected=${encodeURIComponent(state.provider)}`;
        }
        const id = await metaOauthSelectionStore.create({
          companyId: state.companyId,
          userId: state.userId,
          provider: state.provider,
          payload: { accessToken, wabas },
        });
        return selectUrl(id);
      }

      const { accessToken, pages } = await discoverPageAssets({
        provider: state.provider,
        code,
        redirectUri,
        cfg,
      });
      if (pages.length === 1) {
        await connectSelectedPage({
          companyId: state.companyId,
          userId: state.userId,
          provider: state.provider,
          page: pages[0],
          cfg,
        });
        return `${base}?connected=${encodeURIComponent(state.provider)}`;
      }
      const id = await metaOauthSelectionStore.create({
        companyId: state.companyId,
        userId: state.userId,
        provider: state.provider,
        payload: { accessToken, pages },
      });
      return selectUrl(id);
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
  ): Promise<
    { account: ChannelAccountView } | { selection: SelectionView }
  > {
    const cfg = readConfig();
    if (!cfg.appId || !cfg.appSecret) {
      throw AppError.conflict(
        'Meta OAuth is not configured for this deployment',
        [],
        'OAUTH_NOT_CONFIGURED',
      );
    }
    try {
      const { accessToken, wabas } = await discoverWhatsAppAssets({
        code: input.code,
        cfg,
      });

      // The popup can hand us the exact ids the user picked in Meta's own UI.
      // Honour them — but only after checking they are genuinely part of THIS
      // authorization, so a caller cannot name someone else's WABA or a number
      // the grant never covered.
      if (input.wabaId || input.phoneNumberId) {
        const waba = wabas.find((w) => w.wabaId === input.wabaId) ?? wabas[0];
        const phone = input.phoneNumberId
          ? waba?.phones.find((p) => p.phoneNumberId === input.phoneNumberId)
          : waba?.phones[0];
        if (!waba || !phone) {
          throw AppError.badRequest(
            'That WhatsApp account or phone number was not part of this authorization',
            [],
            'ASSET_NOT_IN_GRANT',
          );
        }
        return {
          account: await connectSelectedWhatsApp({
            companyId,
            userId,
            accessToken,
            waba,
            phone,
            cfg,
          }),
        };
      }

      if (countWhatsAppChoices(wabas) === 1) {
        return {
          account: await connectSelectedWhatsApp({
            companyId,
            userId,
            accessToken,
            waba: wabas[0],
            phone: wabas[0].phones[0],
            cfg,
          }),
        };
      }

      // Ambiguous: hand back a selection for the picker instead of guessing.
      const id = await metaOauthSelectionStore.create({
        companyId,
        userId,
        provider: 'whatsapp',
        payload: { accessToken, wabas },
      });
      const loaded = await metaOauthSelectionStore.load(id, companyId);
      return { selection: toClientView(loaded!) };
    } catch (err) {
      if (err instanceof MetaFlowError) {
        const base = FLOW_ERROR_MESSAGES[err.safeCode] ?? 'Meta connection failed';
        throw AppError.badRequest(
          err.detail ? `${base} — Meta said: ${err.detail}` : base,
          [],
          err.safeCode,
        );
      }
      throw err;
    }
  },

  /**
   * Read a pending selection for the picker. Scoped to the caller's company —
   * an id belonging to another tenant is simply "not found".
   */
  async getSelection(
    companyId: string,
    selectionId: string,
  ): Promise<SelectionView> {
    const loaded = await metaOauthSelectionStore.load(selectionId, companyId);
    if (!loaded) throw selectionNotFound();
    return toClientView(loaded);
  },

  /**
   * Connect exactly the asset the operator chose.
   *
   * Two independent checks stand between a request and a live channel, and
   * both matter:
   *   - the selection must belong to the CALLER's company (tenant isolation)
   *   - the chosen ids must be present in THAT selection's stored assets, so a
   *     caller cannot smuggle in an arbitrary Page or WABA id and have the
   *     backend connect it with a token it holds
   */
  async connectSelected(
    companyId: string,
    userId: string,
    selectionId: string,
    choice: { pageId?: string; wabaId?: string; phoneNumberId?: string },
  ): Promise<ChannelAccountView> {
    const cfg = readConfig();
    if (!cfg.appId || !cfg.appSecret) {
      throw AppError.conflict(
        'Meta OAuth is not configured for this deployment',
        [],
        'OAUTH_NOT_CONFIGURED',
      );
    }

    const selection = await metaOauthSelectionStore.load(selectionId, companyId);
    if (!selection) throw selectionNotFound();

    const notInGrant = (): AppError =>
      AppError.badRequest(
        'That account was not part of this authorization',
        [],
        'ASSET_NOT_IN_GRANT',
      );

    // Resolve the choice BEFORE burning the selection, so a bad choice leaves
    // the operator able to try again instead of having to redo the whole
    // Meta authorization.
    const resolved = resolveChoice(selection, choice);
    if (!resolved) throw notInGrant();

    // Burn it now: whatever happens next, this selection cannot be replayed.
    // Losing the race (a double-clicked button) is indistinguishable from a
    // stale id, which is exactly right.
    if (!(await metaOauthSelectionStore.consume(selectionId, companyId))) {
      throw selectionNotFound();
    }

    try {
      if (resolved.kind === 'page') {
        return await connectSelectedPage({
          companyId,
          userId,
          provider: selection.provider === 'instagram' ? 'instagram' : 'facebook',
          page: resolved.page,
          cfg,
        });
      }
      return await connectSelectedWhatsApp({
        companyId,
        userId,
        accessToken: selection.payload.accessToken,
        waba: resolved.waba,
        phone: resolved.phone,
        cfg,
      });
    } catch (err) {
      if (err instanceof MetaFlowError) {
        const base = FLOW_ERROR_MESSAGES[err.safeCode] ?? 'Meta connection failed';
        throw AppError.badRequest(
          err.detail ? `${base} — Meta said: ${err.detail}` : base,
          [],
          err.safeCode,
        );
      }
      throw err;
    }
  },
};

/**
 * Match the operator's choice against the assets actually stored for this
 * selection. Returns null when the choice names anything the grant did not
 * include — which is the check that stops an arbitrary id from being connected.
 */
function resolveChoice(
  selection: LoadedSelection,
  choice: { pageId?: string; wabaId?: string; phoneNumberId?: string },
):
  | { kind: 'page'; page: StoredPageAsset }
  | { kind: 'whatsapp'; waba: StoredWabaAsset; phone: StoredWabaAsset['phones'][number] }
  | null {
  if (selection.provider === 'whatsapp') {
    if (!choice.wabaId || !choice.phoneNumberId) return null;
    const waba = (selection.payload.wabas ?? []).find(
      (w) => w.wabaId === choice.wabaId,
    );
    if (!waba) return null;
    const phone = waba.phones.find(
      (p) => p.phoneNumberId === choice.phoneNumberId,
    );
    // The number must belong to the CHOSEN waba, not merely exist somewhere in
    // the payload — otherwise a valid pair could be assembled from two WABAs.
    if (!phone) return null;
    return { kind: 'whatsapp', waba, phone };
  }

  if (!choice.pageId) return null;
  const page = (selection.payload.pages ?? []).find(
    (p) => p.pageId === choice.pageId,
  );
  if (!page) return null;
  // Instagram selections are pre-filtered to linked Pages, but re-check: the
  // payload is the authority, not the filter that produced it.
  if (selection.provider === 'instagram' && !page.instagramAccountId) {
    return null;
  }
  return { kind: 'page', page };
}
