import { env } from '../../../../config/env';
import {
  classifyFacebookHttp,
  classifyFacebookThrow,
  safeFacebookReason,
  type FacebookErrorCategory,
} from './facebook-error-classifier';
import type {
  FacebookPageResponse,
  FacebookSendResponse,
} from './facebook.types';

/**
 * Injectable transport over the Meta Graph API for Facebook Messenger. Tests
 * inject a fake so the real network is never hit. Never logs the access token
 * or Authorization header.
 */
export interface FacebookHttpRequest {
  url: string;
  method: 'GET' | 'POST';
  accessToken: string;
  body?: unknown;
  timeoutMs: number;
}

export interface FacebookHttpResponse {
  status: number;
  ok: boolean;
  json: unknown;
}

export interface FacebookTransport {
  request(input: FacebookHttpRequest): Promise<FacebookHttpResponse>;
}

const defaultTransport: FacebookTransport = {
  async request(input) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const res = await fetch(input.url, {
        method: input.method,
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          ...(input.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
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

let transport: FacebookTransport = defaultTransport;

/** Test hook: inject a fake transport (null restores the real one). */
export function setFacebookTransportForTesting(t: FacebookTransport | null): void {
  transport = t ?? defaultTransport;
}

export interface FacebookSendOutcome {
  ok: boolean;
  externalMessageId?: string | null;
  category?: FacebookErrorCategory;
  retryable?: boolean;
  code?: string;
  reason?: string;
}

export interface FacebookConnectionOutcome {
  state: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'AUTH_EXPIRED';
  code?: string | null;
  reason?: string | null;
  name?: string | null;
}

function graphUrl(pathSuffix: string): string {
  return `${env.FACEBOOK_GRAPH_API_BASE_URL}/${env.FACEBOOK_GRAPH_API_VERSION}/${pathSuffix}`;
}

function stateFromCategory(
  category: FacebookErrorCategory,
): FacebookConnectionOutcome['state'] {
  switch (category) {
    case 'AUTHENTICATION':
      return 'AUTH_EXPIRED';
    case 'AUTHORIZATION':
    case 'RATE_LIMIT':
    case 'TEMPORARY_PROVIDER_FAILURE':
    case 'NETWORK_FAILURE':
    case 'TIMEOUT':
      return 'DEGRADED';
    default:
      return 'UNAVAILABLE';
  }
}

export const facebookApiClient = {
  /** Send a Messenger text via the Page's messages node. Never throws. */
  async sendText(input: {
    accessToken: string;
    pageId: string;
    recipientId: string;
    text: string;
  }): Promise<FacebookSendOutcome> {
    const body = {
      recipient: { id: input.recipientId },
      messaging_type: 'RESPONSE',
      message: { text: input.text },
    };
    try {
      const res = await transport.request({
        url: graphUrl(`${encodeURIComponent(input.pageId)}/messages`),
        method: 'POST',
        accessToken: input.accessToken,
        body,
        timeoutMs: env.FACEBOOK_API_TIMEOUT_MS,
      });
      if (res.ok) {
        const id = (res.json as FacebookSendResponse | null)?.message_id ?? null;
        return { ok: true, externalMessageId: id };
      }
      const c = classifyFacebookHttp(res.status, res.json);
      return { ok: false, category: c.category, retryable: c.retryable, code: c.code, reason: safeFacebookReason(c.category) };
    } catch (err) {
      const c = classifyFacebookThrow(err);
      return { ok: false, category: c.category, retryable: c.retryable, code: c.code, reason: safeFacebookReason(c.category) };
    }
  },

  /**
   * Best-effort lookup of an inbound sender's public profile. Never throws;
   * returns null on any error. Short bounded timeout so it cannot delay webhooks.
   */
  async getProfile(input: {
    accessToken: string;
    psid: string;
  }): Promise<{ fullName?: string | null } | null> {
    try {
      const res = await transport.request({
        url: graphUrl(`${encodeURIComponent(input.psid)}?fields=name,first_name,last_name`),
        method: 'GET',
        accessToken: input.accessToken,
        timeoutMs: Math.min(env.FACEBOOK_API_TIMEOUT_MS, 4000),
      });
      if (!res.ok) return null;
      const j = res.json as {
        name?: string;
        first_name?: string;
        last_name?: string;
      } | null;
      if (!j) return null;
      const full =
        j.name ??
        [j.first_name, j.last_name].filter(Boolean).join(' ').trim() ??
        null;
      return { fullName: full || null };
    } catch {
      return null;
    }
  },

  /** Validate the connection by reading the Page node. Never throws. */
  async checkPage(input: {
    accessToken: string;
    pageId: string;
  }): Promise<FacebookConnectionOutcome> {
    try {
      const res = await transport.request({
        url: graphUrl(`${encodeURIComponent(input.pageId)}?fields=id,name`),
        method: 'GET',
        accessToken: input.accessToken,
        timeoutMs: env.FACEBOOK_API_TIMEOUT_MS,
      });
      if (res.ok) {
        // A 200 proves the token controls this Page (403 otherwise).
        const j = res.json as FacebookPageResponse | null;
        return { state: 'HEALTHY', name: j?.name ?? null };
      }
      const c = classifyFacebookHttp(res.status, res.json);
      return { state: stateFromCategory(c.category), code: c.code, reason: safeFacebookReason(c.category) };
    } catch (err) {
      const c = classifyFacebookThrow(err);
      return { state: 'UNAVAILABLE', code: c.code, reason: safeFacebookReason(c.category) };
    }
  },
};
