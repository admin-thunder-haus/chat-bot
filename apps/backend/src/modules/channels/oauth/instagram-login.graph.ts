import { env } from '../../../config/env';

/**
 * Minimal API client for "Business Login for Instagram" — the OAuth half of the
 * Instagram API with Instagram Login.
 *
 * This is a SEPARATE client from {@link metaOauthGraphClient} on purpose: the
 * two flows share no host, no credential and no response shape. Business Login
 * exchanges its code at `api.instagram.com`, upgrades and refreshes tokens at
 * `graph.instagram.com`, and authenticates with the Instagram App ID/Secret
 * rather than the Facebook ones. Folding it into the Facebook client would mean
 * a function that silently means something different depending on its caller.
 *
 * Injectable transport (mirrors every other provider client) so tests NEVER hit
 * the real network. Tokens travel as query/form parameters or Authorization
 * headers only — they are never logged and never placed in thrown errors.
 */

export interface InstagramLoginHttpRequest {
  url: string;
  method: 'GET' | 'POST';
  /** Bearer token; omitted when the parameters themselves carry auth. */
  accessToken?: string;
  /** Form-encoded body — the code exchange rejects JSON. */
  form?: Record<string, string>;
  timeoutMs: number;
}

export interface InstagramLoginHttpResponse {
  status: number;
  ok: boolean;
  json: unknown;
}

export interface InstagramLoginTransport {
  request(input: InstagramLoginHttpRequest): Promise<InstagramLoginHttpResponse>;
}

const REQUEST_TIMEOUT_MS = 15_000;
const AUTH_BASE_URL = 'https://api.instagram.com';

const defaultTransport: InstagramLoginTransport = {
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
          ...(input.form
            ? { 'Content-Type': 'application/x-www-form-urlencoded' }
            : {}),
        },
        body: input.form ? new URLSearchParams(input.form).toString() : undefined,
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

let transport: InstagramLoginTransport = defaultTransport;

/** Test hook: inject a fake transport (null restores the real one). */
export function setInstagramLoginTransportForTesting(
  t: InstagramLoginTransport | null,
): void {
  transport = t ?? defaultTransport;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Ids arrive as JSON numbers in some responses and strings in others. */
function asId(v: unknown): string | undefined {
  if (typeof v === 'string' && v.length > 0) return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function graphUrl(pathSuffix: string): string {
  return `${env.INSTAGRAM_GRAPH_API_BASE_URL}/${env.INSTAGRAM_GRAPH_API_VERSION}/${pathSuffix}`;
}

/** Token upgrade/refresh live at the host ROOT, not under a version prefix. */
function graphRootUrl(pathSuffix: string): string {
  return `${env.INSTAGRAM_GRAPH_API_BASE_URL}/${pathSuffix}`;
}

export interface InstagramLoginTokenResult {
  ok: boolean;
  accessToken?: string;
  /** The Instagram professional account this token belongs to. */
  userId?: string;
}

export const instagramLoginGraphClient = {
  /**
   * Exchange the authorization code for a SHORT-lived Instagram User token.
   *
   * Two response shapes are accepted because Meta has shipped both: the current
   * `{ data: [{ access_token, user_id }] }` envelope and the older flat
   * `{ access_token, user_id }`. Guessing one and breaking on the other is a
   * failure that only shows up against the live API, so both are read here.
   */
  async exchangeCode(input: {
    appId: string;
    appSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<InstagramLoginTokenResult> {
    try {
      const res = await transport.request({
        url: `${AUTH_BASE_URL}/oauth/access_token`,
        method: 'POST',
        form: {
          client_id: input.appId,
          client_secret: input.appSecret,
          grant_type: 'authorization_code',
          redirect_uri: input.redirectUri,
          code: input.code,
        },
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
      const root = asRecord(res.json);
      const data = root?.data;
      const payload =
        (Array.isArray(data) ? asRecord(data[0]) : null) ?? root ?? null;
      const token = payload?.access_token;
      if (res.ok && typeof token === 'string' && token.length > 0) {
        return { ok: true, accessToken: token, userId: asId(payload?.user_id) };
      }
      return { ok: false };
    } catch {
      return { ok: false };
    }
  },

  /**
   * Upgrade a short-lived token (1 hour) to a long-lived one (60 days).
   *
   * Not optional: a channel connected with the short-lived token would go
   * AUTH_EXPIRED within the hour, long after the operator stopped watching.
   */
  async exchangeLongLivedToken(input: {
    appSecret: string;
    shortLivedToken: string;
  }): Promise<InstagramLoginTokenResult> {
    const params = new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: input.appSecret,
      access_token: input.shortLivedToken,
    });
    try {
      const res = await transport.request({
        url: graphRootUrl(`access_token?${params.toString()}`),
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

  /**
   * Identify the authorized account: `GET /me?fields=user_id,username`.
   *
   * `user_id` is the one that matters — it is the id Meta puts in `entry[].id`
   * on inbound webhooks, so it is what inbound routing must be stored under.
   * The node's own `id` is a different, app-scoped value; storing that instead
   * produces a channel that sends fine and never receives.
   */
  async getMe(input: { accessToken: string }): Promise<{
    ok: boolean;
    userId?: string;
    username?: string;
  }> {
    try {
      const res = await transport.request({
        url: graphUrl('me?fields=user_id,username'),
        method: 'GET',
        accessToken: input.accessToken,
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
      const j = asRecord(res.json);
      if (!res.ok || !j) return { ok: false };
      const username = typeof j.username === 'string' ? j.username : undefined;
      return { ok: true, userId: asId(j.user_id) ?? asId(j.id), username };
    } catch {
      return { ok: false };
    }
  },
};
