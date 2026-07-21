import type { MetaGraphError } from './instagram.types';

/**
 * Instagram/Meta Graph API error taxonomy, mapped to the framework's retry
 * semantics. Classification considers BOTH the HTTP status and the Meta error
 * `code`/`error_subcode` (Meta frequently returns 400 for auth/permission/rate
 * problems, so status alone is insufficient).
 *
 * No token or raw provider response ever crosses this boundary — callers get a
 * category, a retryable flag, and a stable safe code only.
 */
export type InstagramErrorCategory =
  | 'AUTHENTICATION' // invalid/expired token — permanent, needs reconnect
  | 'AUTHORIZATION' // missing permission/scope — permanent
  | 'RATE_LIMIT' // throttled — transient
  | 'TEMPORARY_PROVIDER_FAILURE' // Meta 5xx / transient (code 1,2) — transient
  | 'NETWORK_FAILURE' // fetch threw — transient
  | 'TIMEOUT' // aborted by timeout — transient
  | 'INVALID_RECIPIENT' // recipient not reachable / outside window — permanent
  | 'INVALID_REQUEST' // malformed request — permanent
  | 'PERMANENT_PROVIDER_FAILURE' // other permanent 4xx — permanent
  | 'UNKNOWN_PROVIDER_FAILURE'; // unmapped — treated as permanent (safe default)

export interface InstagramErrorClassification {
  category: InstagramErrorCategory;
  retryable: boolean;
  /** Stable, safe code for diagnostics/delivery records (never provider text). */
  code: string;
}

/** Meta error codes that mean the access token is invalid/expired. */
const AUTH_CODES = new Set([190, 102, 463, 467]);
/** Meta error codes that mean a missing permission/scope. */
const PERMISSION_CODES = new Set([10, 200, 803, 3, 12]);
/** Meta error codes that mean throttling. */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80007]);
/** Transient internal Meta errors. */
const TRANSIENT_CODES = new Set([1, 2]);
/**
 * code 100 subcodes that indicate the recipient/window is invalid (permanent,
 * do NOT retry): outside the allowed messaging window / user not found.
 */
const INVALID_RECIPIENT_SUBCODES = new Set([2534014, 2534022, 2018001]);

function categoryToOutcome(
  category: InstagramErrorCategory,
): { retryable: boolean; code: string } {
  switch (category) {
    case 'RATE_LIMIT':
      return { retryable: true, code: 'IG_RATE_LIMIT' };
    case 'TEMPORARY_PROVIDER_FAILURE':
      return { retryable: true, code: 'IG_TEMPORARY' };
    case 'NETWORK_FAILURE':
      return { retryable: true, code: 'IG_NETWORK' };
    case 'TIMEOUT':
      return { retryable: true, code: 'IG_TIMEOUT' };
    case 'AUTHENTICATION':
      return { retryable: false, code: 'IG_AUTH' };
    case 'AUTHORIZATION':
      return { retryable: false, code: 'IG_PERMISSION' };
    case 'INVALID_RECIPIENT':
      return { retryable: false, code: 'IG_INVALID_RECIPIENT' };
    case 'INVALID_REQUEST':
      return { retryable: false, code: 'IG_INVALID_REQUEST' };
    case 'PERMANENT_PROVIDER_FAILURE':
      return { retryable: false, code: 'IG_PERMANENT' };
    default:
      return { retryable: false, code: 'IG_UNKNOWN' };
  }
}

/** Classify a completed HTTP response (status + parsed Meta error body). */
export function classifyInstagramHttp(
  status: number,
  json: unknown,
): InstagramErrorClassification {
  const err = (json as MetaGraphError | null)?.error;
  const code = typeof err?.code === 'number' ? err.code : undefined;
  const subcode =
    typeof err?.error_subcode === 'number' ? err.error_subcode : undefined;

  let category: InstagramErrorCategory = 'UNKNOWN_PROVIDER_FAILURE';

  if (code !== undefined && AUTH_CODES.has(code)) {
    category = 'AUTHENTICATION';
  } else if (code !== undefined && PERMISSION_CODES.has(code)) {
    category = 'AUTHORIZATION';
  } else if (code !== undefined && RATE_LIMIT_CODES.has(code)) {
    category = 'RATE_LIMIT';
  } else if (code !== undefined && TRANSIENT_CODES.has(code)) {
    category = 'TEMPORARY_PROVIDER_FAILURE';
  } else if (subcode !== undefined && INVALID_RECIPIENT_SUBCODES.has(subcode)) {
    category = 'INVALID_RECIPIENT';
  } else if (status === 401) {
    category = 'AUTHENTICATION';
  } else if (status === 403) {
    category = 'AUTHORIZATION';
  } else if (status === 429) {
    category = 'RATE_LIMIT';
  } else if (status >= 500) {
    category = 'TEMPORARY_PROVIDER_FAILURE';
  } else if (status === 400) {
    category = code === 100 ? 'INVALID_REQUEST' : 'PERMANENT_PROVIDER_FAILURE';
  } else if (status >= 400) {
    category = 'PERMANENT_PROVIDER_FAILURE';
  }

  const { retryable, code: safeCode } = categoryToOutcome(category);
  return { category, retryable, code: safeCode };
}

/** Classify a thrown transport error (timeout vs generic network failure). */
export function classifyInstagramThrow(
  err: unknown,
): InstagramErrorClassification {
  const isAbort =
    err instanceof Error &&
    (err.name === 'AbortError' || /abort/i.test(err.message));
  const category: InstagramErrorCategory = isAbort ? 'TIMEOUT' : 'NETWORK_FAILURE';
  const { retryable, code } = categoryToOutcome(category);
  return { category, retryable, code };
}

/** Safe, user-presentable summary for a category — never provider internals. */
export function safeInstagramReason(category: InstagramErrorCategory): string {
  switch (category) {
    case 'AUTHENTICATION':
      return 'Instagram access token is invalid or expired';
    case 'AUTHORIZATION':
      return 'The Instagram app is missing a required permission';
    case 'RATE_LIMIT':
      return 'Instagram rate limit reached; will retry shortly';
    case 'TEMPORARY_PROVIDER_FAILURE':
      return 'Instagram is temporarily unavailable';
    case 'NETWORK_FAILURE':
      return 'Instagram API is temporarily unreachable';
    case 'TIMEOUT':
      return 'Instagram API request timed out';
    case 'INVALID_RECIPIENT':
      return 'Cannot message this recipient (outside the allowed window)';
    case 'INVALID_REQUEST':
      return 'Instagram rejected the message request';
    case 'PERMANENT_PROVIDER_FAILURE':
      return 'Instagram rejected the request';
    default:
      return 'Instagram request failed';
  }
}
