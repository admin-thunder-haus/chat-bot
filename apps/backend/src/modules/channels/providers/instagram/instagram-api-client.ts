import { env } from '../../../../config/env';
import {
  classifyInstagramHttp,
  classifyInstagramThrow,
  safeInstagramReason,
  type InstagramErrorCategory,
} from './instagram-error-classifier';
import type {
  InstagramAccountResponse,
  InstagramSendResponse,
} from './instagram.types';

/**
 * Minimal transport abstraction over the Meta Graph API for Instagram. Injectable
 * so tests NEVER hit the real network (mirrors the WhatsApp/AI provider pattern).
 * The default transport uses global `fetch` with a bounded timeout and never logs
 * the access token or Authorization header.
 */
export interface InstagramHttpRequest {
  url: string;
  method: 'GET' | 'POST';
  accessToken: string;
  body?: unknown;
  timeoutMs: number;
}

export interface InstagramHttpResponse {
  status: number;
  ok: boolean;
  json: unknown;
}

export interface InstagramTransport {
  request(input: InstagramHttpRequest): Promise<InstagramHttpResponse>;
}

const defaultTransport: InstagramTransport = {
  async request(input) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const res = await fetch(input.url, {
        method: input.method,
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
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

let transport: InstagramTransport = defaultTransport;

/** Test hook: inject a fake transport (null restores the real one). */
export function setInstagramTransportForTesting(
  t: InstagramTransport | null,
): void {
  transport = t ?? defaultTransport;
}

export interface InstagramSendOutcome {
  ok: boolean;
  externalMessageId?: string | null;
  category?: InstagramErrorCategory;
  retryable?: boolean;
  code?: string;
  reason?: string;
}

export interface InstagramConnectionOutcome {
  state: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'AUTH_EXPIRED';
  code?: string | null;
  reason?: string | null;
  username?: string | null;
  name?: string | null;
}

function graphUrl(pathSuffix: string): string {
  return `${env.INSTAGRAM_GRAPH_API_BASE_URL}/${env.INSTAGRAM_GRAPH_API_VERSION}/${pathSuffix}`;
}

/** Map a completed classification to a health connection state. */
function stateFromCategory(
  category: InstagramErrorCategory,
): InstagramConnectionOutcome['state'] {
  switch (category) {
    case 'AUTHENTICATION':
      return 'AUTH_EXPIRED';
    case 'AUTHORIZATION':
      return 'DEGRADED';
    case 'RATE_LIMIT':
    case 'TEMPORARY_PROVIDER_FAILURE':
    case 'NETWORK_FAILURE':
    case 'TIMEOUT':
      return 'DEGRADED';
    default:
      return 'UNAVAILABLE';
  }
}

export const instagramApiClient = {
  /**
   * Send an Instagram DM text message via the connected professional account's
   * messages node. Returns a normalized outcome (never throws).
   */
  async sendText(input: {
    accessToken: string;
    instagramAccountId: string;
    recipientId: string;
    text: string;
  }): Promise<InstagramSendOutcome> {
    const body = {
      recipient: { id: input.recipientId },
      message: { text: input.text },
    };
    try {
      const res = await transport.request({
        url: graphUrl(`${encodeURIComponent(input.instagramAccountId)}/messages`),
        method: 'POST',
        accessToken: input.accessToken,
        body,
        timeoutMs: env.INSTAGRAM_API_TIMEOUT_MS,
      });
      if (res.ok) {
        const id = (res.json as InstagramSendResponse | null)?.message_id ?? null;
        return { ok: true, externalMessageId: id };
      }
      const c = classifyInstagramHttp(res.status, res.json);
      return {
        ok: false,
        category: c.category,
        retryable: c.retryable,
        code: c.code,
        reason: safeInstagramReason(c.category),
      };
    } catch (err) {
      const c = classifyInstagramThrow(err);
      return {
        ok: false,
        category: c.category,
        retryable: c.retryable,
        code: c.code,
        reason: safeInstagramReason(c.category),
      };
    }
  },

  /**
   * Best-effort lookup of an inbound sender's public profile. Never throws;
   * returns null on any error. Uses a short bounded timeout so it cannot delay
   * webhook processing.
   */
  async getProfile(input: {
    accessToken: string;
    igsid: string;
  }): Promise<{ fullName?: string | null; username?: string | null } | null> {
    try {
      const res = await transport.request({
        url: graphUrl(`${encodeURIComponent(input.igsid)}?fields=name,username`),
        method: 'GET',
        accessToken: input.accessToken,
        timeoutMs: Math.min(env.INSTAGRAM_API_TIMEOUT_MS, 4000),
      });
      if (!res.ok) return null;
      const j = res.json as { name?: string; username?: string } | null;
      if (!j) return null;
      return { fullName: j.name ?? null, username: j.username ?? null };
    } catch {
      return null;
    }
  },

  /**
   * Validate the connection by reading the Instagram account node. Never throws.
   * A successful read with a matching id confirms token + account accessibility.
   */
  async checkAccount(input: {
    accessToken: string;
    instagramAccountId: string;
  }): Promise<InstagramConnectionOutcome> {
    try {
      const res = await transport.request({
        // `id,username` only — `name` is not a valid field on the Instagram
        // Login user node and would 400 there.
        url: graphUrl(
          `${encodeURIComponent(input.instagramAccountId)}?fields=id,username`,
        ),
        method: 'GET',
        accessToken: input.accessToken,
        timeoutMs: env.INSTAGRAM_API_TIMEOUT_MS,
      });
      if (res.ok) {
        // A 200 from GET /{account-id} already proves the token controls this
        // account (the Graph API returns 403/permission otherwise). No strict
        // id-equality check: Instagram Login exposes both an `id` and a
        // `user_id` for the same account, so a returned id may legitimately
        // differ from the one the tenant entered — that is not a mismatch.
        const j = res.json as InstagramAccountResponse | null;
        return {
          state: 'HEALTHY',
          username: j?.username ?? null,
          name: j?.name ?? null,
        };
      }
      const c = classifyInstagramHttp(res.status, res.json);
      return {
        state: stateFromCategory(c.category),
        code: c.code,
        reason: safeInstagramReason(c.category),
      };
    } catch (err) {
      const c = classifyInstagramThrow(err);
      return {
        state: 'UNAVAILABLE',
        code: c.code,
        reason: safeInstagramReason(c.category),
      };
    }
  },
};
