import type { Event, User } from '@sentry/node';
import { env } from './env';
import { logger } from '../utils/logger';

/**
 * Optional error tracking. Sentry is OFF unless SENTRY_DSN is set, and "off"
 * means the SDK is never even loaded: the import below is TYPE-ONLY and the
 * real module is pulled in lazily inside initSentry(). Without a DSN there is
 * no init, no network, no instrumentation and no measurable overhead — which is
 * what every dev machine and the whole test suite run with.
 *
 * Scope is deliberately narrow: unexpected server errors reported from the
 * CENTRAL error middleware. No request/tracing middleware is installed, so
 * normal traffic is never wrapped and no performance data is produced (see
 * SENTRY_TRACES_SAMPLE_RATE, default 0).
 */

/** The lazily-loaded SDK. Non-null ONLY after a successful init with a DSN. */
type SentrySdk = typeof import('@sentry/node');
let sdk: SentrySdk | null = null;

/** Context attached to a captured error. All fields are optional and safe. */
export interface SentryErrorContext {
  requestId?: string;
  companyId?: string;
  /** "METHOD route" — the route PATTERN when Express exposes it. */
  route?: string;
}

// --- Scrubbing -------------------------------------------------------------

const REDACTED = '[redacted]';
const CIRCULAR = '[circular]';
const TOO_DEEP = '[redacted: too deep]';

/**
 * Depth cap for recursive redaction. A payload nested deeper than this is
 * dropped wholesale rather than sent unchecked — a nested body must never be
 * able to smuggle a secret past the scrubber by being one level deeper.
 */
const MAX_DEPTH = 6;

/**
 * Substrings that make a key secret-ish. Matched against the key with case and
 * separators stripped, so `X-API-Key`, `api_key` and `apiKey` all hit `key`.
 * Deliberately over-broad (`key` also redacts `providerKey`, `auth` also
 * redacts `author`): losing a debugging breadcrumb costs far less than leaking
 * a credential.
 */
const SECRET_KEY_FRAGMENTS = [
  'token',
  'secret',
  'password',
  'passwd',
  'credential',
  'signature',
  'dsn',
  'key',
  'auth',
];

/**
 * Headers redacted by name regardless of the fragment match above. Includes
 * every webhook signature header the platform accepts — Meta
 * (`x-hub-signature-256`, WhatsApp/Instagram/Messenger), Telegram, Stripe, the
 * outbound-webhook signature and the development fake channel — plus the
 * credential headers (`cookie` matches no fragment, so it must be listed).
 */
const ALWAYS_REDACTED_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-hub-signature',
  'x-hub-signature-256',
  'x-telegram-bot-api-secret-token',
  'stripe-signature',
  'x-webhook-signature',
  'x-fake-signature',
];

/** PII fields removed from any attached user object (`id` is kept). */
const REDACTED_USER_FIELDS = ['email', 'phone', 'phoneNumber', 'ip_address'];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** True when a query/body/header key looks like it carries a secret. */
function isSecretKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SECRET_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function isRedactedHeader(name: string): boolean {
  return ALWAYS_REDACTED_HEADERS.includes(name.toLowerCase()) || isSecretKey(name);
}

/**
 * Recursively replace secret-ish values. Guards against the three ways this
 * could otherwise blow up on hostile input: cycles (WeakSet), unbounded depth
 * (MAX_DEPTH) and non-plain objects (Dates are passed through untouched
 * instead of being flattened to `{}`).
 */
function redactDeep(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (seen.has(value)) return CIRCULAR;
  if (depth >= MAX_DEPTH) return TOO_DEEP;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, depth + 1, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = isSecretKey(key) ? REDACTED : redactDeep(item, depth + 1, seen);
  }
  return result;
}

/** Entry point for the recursion — one WeakSet per top-level value. */
function redactValue(value: unknown): unknown {
  return redactDeep(value, 0, new WeakSet<object>());
}

/** Redact secret-ish params inside a raw `a=1&token=…` query string. */
function redactQueryString(query: string): string {
  const params = new URLSearchParams(query);
  const out = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    out.append(key, isSecretKey(key) ? REDACTED : value);
  }
  return out.toString();
}

/** Keep the path, scrub the query string — urls are the classic leak path. */
function redactUrl(url: string): string {
  const index = url.indexOf('?');
  if (index === -1) return url;
  const query = redactQueryString(url.slice(index + 1));
  return query ? `${url.slice(0, index)}?${query}` : url.slice(0, index);
}

function redactUser(user: User): User {
  const result: User = { ...user };
  for (const field of REDACTED_USER_FIELDS) {
    if (result[field] !== undefined && result[field] !== null) {
      result[field] = REDACTED;
    }
  }
  return result;
}

/**
 * Remove secrets and PII from an outgoing event. Exported and PURE so it can be
 * unit-tested without a DSN, a network or an initialised SDK — the scrubber is
 * the part of this integration that must never silently regress.
 *
 * Never throws: a scrubber that crashes inside `beforeSend` would drop the
 * event *and* log noise on every 500, so unexpected shapes fall back to
 * dropping the request payload entirely.
 */
export function scrubEvent<T extends Event>(event: T): T {
  if (!event || typeof event !== 'object') return event;

  try {
    const request = event.request;
    if (request) {
      if (request.headers) {
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(request.headers)) {
          headers[name] = isRedactedHeader(name) ? REDACTED : value;
        }
        request.headers = headers;
      }
      // Cookies are session credentials wholesale — never itemised.
      if (request.cookies) {
        request.cookies = { [REDACTED]: REDACTED };
      }
      if (request.data !== undefined) {
        request.data = redactValue(request.data);
      }
      if (typeof request.query_string === 'string') {
        request.query_string = redactQueryString(request.query_string);
      } else if (Array.isArray(request.query_string)) {
        request.query_string = request.query_string.map(
          ([key, value]) =>
            [key, isSecretKey(key) ? REDACTED : value] as [string, string],
        );
      } else if (request.query_string) {
        request.query_string = redactValue(request.query_string) as Record<
          string,
          string
        >;
      }
      if (typeof request.url === 'string') {
        request.url = redactUrl(request.url);
      }
    }

    if (event.user) {
      event.user = redactUser(event.user);
    }
    if (event.extra) {
      event.extra = redactValue(event.extra) as typeof event.extra;
    }
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map((crumb) =>
        crumb.data
          ? { ...crumb, data: redactValue(crumb.data) as typeof crumb.data }
          : crumb,
      );
    }
    return event;
  } catch {
    // Unknown shape: keep the exception, drop everything request-shaped.
    delete event.request;
    delete event.user;
    delete event.extra;
    return event;
  }
}

// --- Lifecycle -------------------------------------------------------------

/**
 * Load and initialise Sentry once, at startup, before the Express app exists.
 * A missing DSN is the normal case and logs a single line so an operator can
 * tell "disabled" apart from "misconfigured".
 */
export async function initSentry(): Promise<void> {
  if (sdk) return;

  const dsn = env.SENTRY_DSN;
  if (!dsn) {
    logger.info('Sentry is disabled (SENTRY_DSN is not set)');
    return;
  }

  try {
    // Lazy import: with no DSN this module is never loaded at all.
    const loaded = await import('@sentry/node');
    loaded.init({
      dsn,
      // Defaults to NODE_ENV so a deploy never has to repeat itself.
      environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
      // 0 by default: this integration reports errors, it does not trace.
      tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
      // Never let the SDK collect PII on its own (ip, headers, cookies, body).
      sendDefaultPii: false,
      beforeSend: (event) => scrubEvent(event),
    });
    sdk = loaded;
    logger.info('Sentry error tracking enabled', {
      environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
      tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    });
  } catch (err) {
    // Error tracking is an aid, never a startup dependency.
    logger.warn('Failed to initialise Sentry, continuing without it', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** True once a DSN was supplied and the SDK initialised successfully. */
export function isSentryEnabled(): boolean {
  return sdk !== null;
}

/**
 * Report one unexpected server error. A no-op while uninitialised, so call
 * sites never need to branch on whether Sentry is configured.
 *
 * Tags are low-cardinality on purpose: the route PATTERN (not the raw path
 * with ids in it) plus companyId, with requestId as a searchable tag that ties
 * a Sentry issue back to the structured log line for the same request.
 */
export function captureServerError(
  err: unknown,
  context: SentryErrorContext = {},
): void {
  const active = sdk;
  if (!active) return;

  active.withScope((scope) => {
    if (context.requestId) scope.setTag('requestId', context.requestId);
    if (context.companyId) scope.setTag('companyId', context.companyId);
    if (context.route) scope.setTag('route', context.route);
    active.captureException(err);
  });
}
