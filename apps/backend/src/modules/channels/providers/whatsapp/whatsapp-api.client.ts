import { env } from '../../../../config/env';
import type { MetaApiError } from './whatsapp.types';

/**
 * Minimal transport abstraction over the Meta Graph API. Injectable so tests
 * NEVER hit the real network (mirrors the AI provider's test injection). The
 * default transport uses global `fetch` with a bounded timeout.
 */
export interface WhatsAppHttpRequest {
  url: string;
  method: 'GET' | 'POST';
  accessToken: string;
  body?: unknown;
  timeoutMs: number;
}

export interface WhatsAppHttpResponse {
  status: number;
  ok: boolean;
  json: unknown;
}

export interface WhatsAppTransport {
  request(input: WhatsAppHttpRequest): Promise<WhatsAppHttpResponse>;
}

const defaultTransport: WhatsAppTransport = {
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

let transport: WhatsAppTransport = defaultTransport;

/** Test hook: inject a fake transport (null restores the real one). */
export function setWhatsAppTransportForTesting(
  t: WhatsAppTransport | null,
): void {
  transport = t ?? defaultTransport;
}

/** How the delivery/health layers should react to a Graph API outcome. */
export type WhatsAppErrorCategory =
  | 'auth' // token invalid/expired — permanent, needs reconnect
  | 'rate_limit' // 429 — transient, retry with backoff
  | 'server' // 5xx — transient
  | 'network' // timeout / fetch threw — transient
  | 'client' // 4xx (bad request, unknown number) — permanent
  | 'unknown';

export interface WhatsAppSendOutcome {
  ok: boolean;
  externalMessageId?: string | null;
  category?: WhatsAppErrorCategory;
  retryable?: boolean;
  code?: string;
  reason?: string;
}

export interface WhatsAppConnectionOutcome {
  state: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'AUTH_EXPIRED';
  code?: string | null;
  reason?: string | null;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
}

function graphUrl(pathSuffix: string): string {
  return `${env.WHATSAPP_API_BASE_URL}/${env.WHATSAPP_API_VERSION}/${pathSuffix}`;
}

/** Classify an HTTP status into a retry category (never exposes the token). */
function classify(status: number): {
  category: WhatsAppErrorCategory;
  retryable: boolean;
} {
  if (status === 401 || status === 403) return { category: 'auth', retryable: false };
  if (status === 429) return { category: 'rate_limit', retryable: true };
  if (status >= 500) return { category: 'server', retryable: true };
  if (status >= 400) return { category: 'client', retryable: false };
  return { category: 'unknown', retryable: false };
}

function metaErrorReason(json: unknown): string {
  const err = (json as MetaApiError | null)?.error;
  // Safe, user-presentable summary only — never tokens or internal details.
  if (err?.code) return `Meta error ${err.code}`;
  return 'WhatsApp API request failed';
}

export const whatsAppApiClient = {
  /** Send a WhatsApp text message. Returns a normalized outcome (never throws). */
  async sendText(input: {
    accessToken: string;
    phoneNumberId: string;
    to: string;
    text: string;
    replyToMessageId?: string | null;
  }): Promise<WhatsAppSendOutcome> {
    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.to,
      type: 'text',
      text: { preview_url: false, body: input.text },
    };
    if (input.replyToMessageId) {
      body.context = { message_id: input.replyToMessageId };
    }
    return this.sendPayload(input, body);
  },

  /** Send an image (by public URL) with an optional caption. Never throws. */
  async sendImage(input: {
    accessToken: string;
    phoneNumberId: string;
    to: string;
    imageUrl: string;
    caption?: string | null;
    replyToMessageId?: string | null;
  }): Promise<WhatsAppSendOutcome> {
    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.to,
      type: 'image',
      image: {
        link: input.imageUrl,
        ...(input.caption ? { caption: input.caption } : {}),
      },
    };
    if (input.replyToMessageId) {
      body.context = { message_id: input.replyToMessageId };
    }
    return this.sendPayload(input, body);
  },

  /** Shared POST /messages call used by both text and image sends. */
  async sendPayload(
    input: { accessToken: string; phoneNumberId: string },
    body: Record<string, unknown>,
  ): Promise<WhatsAppSendOutcome> {
    try {
      const res = await transport.request({
        url: graphUrl(`${encodeURIComponent(input.phoneNumberId)}/messages`),
        method: 'POST',
        accessToken: input.accessToken,
        body,
        timeoutMs: env.WHATSAPP_REQUEST_TIMEOUT_MS,
      });
      if (res.ok) {
        const messages = (res.json as { messages?: { id?: string }[] } | null)
          ?.messages;
        const id = Array.isArray(messages) ? messages[0]?.id ?? null : null;
        return { ok: true, externalMessageId: id };
      }
      const { category, retryable } = classify(res.status);
      return {
        ok: false,
        category,
        retryable,
        code: `WA_HTTP_${res.status}`,
        reason: metaErrorReason(res.json),
      };
    } catch {
      // Timeout / abort / network — transient.
      return {
        ok: false,
        category: 'network',
        retryable: true,
        code: 'WA_NETWORK',
        reason: 'WhatsApp API is temporarily unreachable',
      };
    }
  },

  /** Validate the connection by reading the phone number node. Never throws. */
  async checkPhoneNumber(input: {
    accessToken: string;
    phoneNumberId: string;
  }): Promise<WhatsAppConnectionOutcome> {
    try {
      const res = await transport.request({
        url: graphUrl(
          `${encodeURIComponent(input.phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`,
        ),
        method: 'GET',
        accessToken: input.accessToken,
        timeoutMs: env.WHATSAPP_REQUEST_TIMEOUT_MS,
      });
      if (res.ok) {
        const j = res.json as {
          display_phone_number?: string;
          verified_name?: string;
        } | null;
        return {
          state: 'HEALTHY',
          displayPhoneNumber: j?.display_phone_number ?? null,
          verifiedName: j?.verified_name ?? null,
        };
      }
      const { category } = classify(res.status);
      if (category === 'auth') {
        return {
          state: 'AUTH_EXPIRED',
          code: 'WA_AUTH',
          reason: 'Access token is invalid or expired',
        };
      }
      if (category === 'rate_limit' || category === 'server') {
        return {
          state: 'DEGRADED',
          code: `WA_HTTP_${res.status}`,
          reason: 'WhatsApp API is degraded',
        };
      }
      return {
        state: 'UNAVAILABLE',
        code: `WA_HTTP_${res.status}`,
        reason: metaErrorReason(res.json),
      };
    } catch {
      return {
        state: 'UNAVAILABLE',
        code: 'WA_NETWORK',
        reason: 'WhatsApp API is temporarily unreachable',
      };
    }
  },
};
