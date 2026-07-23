/**
 * Minimal Graph API client for the Meta OAuth / Embedded Signup flow.
 * Injectable transport (mirrors the WhatsApp/Facebook API clients) so tests
 * NEVER hit the real network. Tokens are only ever sent as Authorization
 * headers or query parameters to graph.facebook.com — they are never logged
 * and never included in thrown errors.
 */

export interface MetaOauthHttpRequest {
  url: string;
  method: 'GET' | 'POST';
  /** Bearer token; omitted for the code-exchange call (params carry auth). */
  accessToken?: string;
  body?: unknown;
  timeoutMs: number;
}

export interface MetaOauthHttpResponse {
  status: number;
  ok: boolean;
  json: unknown;
}

export interface MetaOauthTransport {
  request(input: MetaOauthHttpRequest): Promise<MetaOauthHttpResponse>;
}

const REQUEST_TIMEOUT_MS = 15_000;
const GRAPH_BASE_URL = 'https://graph.facebook.com';

const defaultTransport: MetaOauthTransport = {
  async request(input) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const res = await fetch(input.url, {
        method: input.method,
        headers: {
          ...(input.accessToken
            ? { Authorization: `Bearer ${input.accessToken}` }
            : {}),
          ...(input.body !== undefined
            ? { 'Content-Type': 'application/json' }
            : {}),
        },
        body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
        signal: controller.signal,
      });
      let json: unknown = null;
      const text = await res.text();
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }
      return { status: res.status, ok: res.ok, json };
    } finally {
      clearTimeout(timer);
    }
  },
};

let transport: MetaOauthTransport = defaultTransport;

/** Test hook: inject a fake transport (null restores the real one). */
export function setMetaOauthTransportForTesting(
  t: MetaOauthTransport | null,
): void {
  transport = t ?? defaultTransport;
}

function graphUrl(version: string, pathSuffix: string): string {
  return `${GRAPH_BASE_URL}/${version}/${pathSuffix}`;
}

/** A Facebook Page as returned by GET /me/accounts. */
export interface MetaPage {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: { id?: string };
}

export interface MetaPhoneNumber {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

export const metaOauthGraphClient = {
  /**
   * Exchange an OAuth authorization code for an access token.
   * `redirectUri` MUST match the one used in the authorize dialog for the
   * redirect flow; the JS-SDK Embedded Signup popup variant omits it.
   */
  async exchangeCode(input: {
    version: string;
    appId: string;
    appSecret: string;
    code: string;
    redirectUri?: string;
  }): Promise<{ ok: boolean; accessToken?: string }> {
    const params = new URLSearchParams({
      client_id: input.appId,
      client_secret: input.appSecret,
      code: input.code,
    });
    if (input.redirectUri) params.set('redirect_uri', input.redirectUri);
    try {
      const res = await transport.request({
        url: graphUrl(input.version, `oauth/access_token?${params.toString()}`),
        method: 'GET',
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
      const token = asRecord(res.json)?.access_token;
      if (res.ok && typeof token === 'string' && token.length > 0) {
        return { ok: true, accessToken: token };
      }
      return { ok: false };
    } catch {
      return { ok: false };
    }
  },

  /** List the Pages the user granted access to (with Page tokens). */
  async getPages(input: {
    version: string;
    accessToken: string;
  }): Promise<{ ok: boolean; pages: MetaPage[] }> {
    try {
      const res = await transport.request({
        url: graphUrl(
          input.version,
          'me/accounts?fields=id,name,access_token,instagram_business_account',
        ),
        method: 'GET',
        accessToken: input.accessToken,
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
      const data = asRecord(res.json)?.data;
      if (res.ok && Array.isArray(data)) {
        return { ok: true, pages: data as MetaPage[] };
      }
      return { ok: false, pages: [] };
    } catch {
      return { ok: false, pages: [] };
    }
  },

  /**
   * Inspect a token via GET /debug_token (authenticated with the app token
   * `appId|appSecret`). Used to read the granular_scopes granted by Embedded
   * Signup, which carry the shared WABA id.
   */
  async debugToken(input: {
    version: string;
    appId: string;
    appSecret: string;
    inputToken: string;
  }): Promise<{
    ok: boolean;
    granularScopes: { scope: string; target_ids?: string[] }[];
  }> {
    const params = new URLSearchParams({ input_token: input.inputToken });
    try {
      const res = await transport.request({
        url: graphUrl(input.version, `debug_token?${params.toString()}`),
        method: 'GET',
        accessToken: `${input.appId}|${input.appSecret}`,
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
      const data = asRecord(asRecord(res.json)?.data);
      const scopes = data?.granular_scopes;
      if (res.ok && Array.isArray(scopes)) {
        return {
          ok: true,
          granularScopes: scopes as { scope: string; target_ids?: string[] }[],
        };
      }
      return { ok: res.ok, granularScopes: [] };
    } catch {
      return { ok: false, granularScopes: [] };
    }
  },

  /** List phone numbers registered under a WhatsApp Business Account. */
  async getPhoneNumbers(input: {
    version: string;
    accessToken: string;
    wabaId: string;
  }): Promise<{ ok: boolean; phones: MetaPhoneNumber[] }> {
    try {
      const res = await transport.request({
        url: graphUrl(
          input.version,
          `${encodeURIComponent(input.wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name`,
        ),
        method: 'GET',
        accessToken: input.accessToken,
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
      const data = asRecord(res.json)?.data;
      if (res.ok && Array.isArray(data)) {
        return { ok: true, phones: data as MetaPhoneNumber[] };
      }
      return { ok: false, phones: [] };
    } catch {
      return { ok: false, phones: [] };
    }
  },

  /**
   * Subscribe our app to a node's webhooks (POST /{id}/subscribed_apps).
   * Pages take subscribed_fields; WABAs subscribe the app as a whole.
   * Never throws — failures are non-fatal (webhooks can be wired manually).
   */
  async subscribeApp(input: {
    version: string;
    accessToken: string;
    nodeId: string;
    subscribedFields?: string;
  }): Promise<{ ok: boolean }> {
    try {
      const res = await transport.request({
        url: graphUrl(
          input.version,
          `${encodeURIComponent(input.nodeId)}/subscribed_apps`,
        ),
        method: 'POST',
        accessToken: input.accessToken,
        body: input.subscribedFields
          ? { subscribed_fields: input.subscribedFields }
          : {},
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  },
};
