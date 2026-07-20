import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';

/**
 * Stateless, signed Web Chat session tokens. A session identifies a persistent
 * anonymous *visitor* (not a single conversation), so a browser reconnect after
 * refresh simply re-sends its stored token. No session table is needed — the
 * visitor is persisted as a Customer (channelType WEBCHAT, externalId = visitorId)
 * and the conversation is resolved per request from that customer.
 *
 * Token format: base64url(payload).base64url(hmacSHA256(payload)).
 * Payload = { v: visitorId, c: companyId, a: channelAccountId, iat }.
 */
export interface WidgetSession {
  visitorId: string;
  companyId: string;
  channelAccountId: string;
  issuedAt: number;
}

let cachedSecret: string | null = null;

function getSecret(): string {
  if (cachedSecret) return cachedSecret;
  const s = env.WIDGET_SESSION_SECRET;
  if (!s || s.length < 32) {
    throw AppError.internal(
      'Web Chat is not configured (WIDGET_SESSION_SECRET missing or too short)',
    );
  }
  cachedSecret = s;
  return s;
}

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function sign(payload: string): string {
  return b64url(createHmac('sha256', getSecret()).update(payload).digest());
}

export const widgetSessionService = {
  /** True when a session secret is configured (used to gate Web Chat cleanly). */
  isConfigured(): boolean {
    try {
      getSecret();
      return true;
    } catch {
      return false;
    }
  },

  newVisitorId(): string {
    return `wcv_${randomUUID().replace(/-/g, '')}`;
  },

  issue(session: Omit<WidgetSession, 'issuedAt'>): string {
    const payload = b64url(
      Buffer.from(
        JSON.stringify({
          v: session.visitorId,
          c: session.companyId,
          a: session.channelAccountId,
          iat: Date.now(),
        }),
      ),
    );
    return `${payload}.${sign(payload)}`;
  },

  /**
   * Verify + decode a token. Returns null (never throws) for any malformed,
   * tampered, or expired token, so callers can transparently start a new session.
   */
  verify(token: string | undefined | null): WidgetSession | null {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, signature] = parts;
    const expected = sign(payload);
    // Constant-time signature comparison.
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const json = JSON.parse(
        Buffer.from(
          payload.replace(/-/g, '+').replace(/_/g, '/'),
          'base64',
        ).toString('utf8'),
      ) as { v?: string; c?: string; a?: string; iat?: number };
      if (!json.v || !json.c || !json.a || !json.iat) return null;
      if (Date.now() - json.iat > env.WIDGET_SESSION_TTL_MS) return null;
      return {
        visitorId: json.v,
        companyId: json.c,
        channelAccountId: json.a,
        issuedAt: json.iat,
      };
    } catch {
      return null;
    }
  },
};
