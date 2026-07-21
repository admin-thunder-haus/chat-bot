import type { MetaGraphError } from './facebook.types';

/**
 * Facebook Messenger / Meta Graph API error taxonomy, mapped to the framework's
 * retry semantics. Classification uses BOTH the HTTP status and the Meta error
 * `code`/`error_subcode` (Meta often returns 400 for auth/permission/rate). No
 * token or raw provider response crosses this boundary.
 */
export type FacebookErrorCategory =
  | 'AUTHENTICATION'
  | 'AUTHORIZATION'
  | 'RATE_LIMIT'
  | 'TEMPORARY_PROVIDER_FAILURE'
  | 'NETWORK_FAILURE'
  | 'TIMEOUT'
  | 'INVALID_RECIPIENT'
  | 'INVALID_REQUEST'
  | 'PERMANENT_PROVIDER_FAILURE'
  | 'UNKNOWN_PROVIDER_FAILURE';

export interface FacebookErrorClassification {
  category: FacebookErrorCategory;
  retryable: boolean;
  code: string;
}

const AUTH_CODES = new Set([190, 102, 463, 467]);
const PERMISSION_CODES = new Set([10, 200, 3, 12, 599]);
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80006]);
const TRANSIENT_CODES = new Set([1, 2]);
/** Messaging-window / invalid-recipient subcodes (permanent). */
const INVALID_RECIPIENT_SUBCODES = new Set([2018001, 2018278, 2534014]);

function outcome(category: FacebookErrorCategory): { retryable: boolean; code: string } {
  switch (category) {
    case 'RATE_LIMIT':
      return { retryable: true, code: 'FB_RATE_LIMIT' };
    case 'TEMPORARY_PROVIDER_FAILURE':
      return { retryable: true, code: 'FB_TEMPORARY' };
    case 'NETWORK_FAILURE':
      return { retryable: true, code: 'FB_NETWORK' };
    case 'TIMEOUT':
      return { retryable: true, code: 'FB_TIMEOUT' };
    case 'AUTHENTICATION':
      return { retryable: false, code: 'FB_AUTH' };
    case 'AUTHORIZATION':
      return { retryable: false, code: 'FB_PERMISSION' };
    case 'INVALID_RECIPIENT':
      return { retryable: false, code: 'FB_INVALID_RECIPIENT' };
    case 'INVALID_REQUEST':
      return { retryable: false, code: 'FB_INVALID_REQUEST' };
    case 'PERMANENT_PROVIDER_FAILURE':
      return { retryable: false, code: 'FB_PERMANENT' };
    default:
      return { retryable: false, code: 'FB_UNKNOWN' };
  }
}

export function classifyFacebookHttp(
  status: number,
  json: unknown,
): FacebookErrorClassification {
  const err = (json as MetaGraphError | null)?.error;
  const code = typeof err?.code === 'number' ? err.code : undefined;
  const subcode =
    typeof err?.error_subcode === 'number' ? err.error_subcode : undefined;

  let category: FacebookErrorCategory = 'UNKNOWN_PROVIDER_FAILURE';
  if (code !== undefined && AUTH_CODES.has(code)) category = 'AUTHENTICATION';
  else if (code !== undefined && PERMISSION_CODES.has(code)) category = 'AUTHORIZATION';
  else if (code !== undefined && RATE_LIMIT_CODES.has(code)) category = 'RATE_LIMIT';
  else if (code !== undefined && TRANSIENT_CODES.has(code)) category = 'TEMPORARY_PROVIDER_FAILURE';
  else if (subcode !== undefined && INVALID_RECIPIENT_SUBCODES.has(subcode)) category = 'INVALID_RECIPIENT';
  else if (status === 401) category = 'AUTHENTICATION';
  else if (status === 403) category = 'AUTHORIZATION';
  else if (status === 429) category = 'RATE_LIMIT';
  else if (status >= 500) category = 'TEMPORARY_PROVIDER_FAILURE';
  else if (status === 400) category = code === 100 ? 'INVALID_REQUEST' : 'PERMANENT_PROVIDER_FAILURE';
  else if (status >= 400) category = 'PERMANENT_PROVIDER_FAILURE';

  const { retryable, code: safeCode } = outcome(category);
  return { category, retryable, code: safeCode };
}

export function classifyFacebookThrow(err: unknown): FacebookErrorClassification {
  const isAbort =
    err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message));
  const category: FacebookErrorCategory = isAbort ? 'TIMEOUT' : 'NETWORK_FAILURE';
  const { retryable, code } = outcome(category);
  return { category, retryable, code };
}

export function safeFacebookReason(category: FacebookErrorCategory): string {
  switch (category) {
    case 'AUTHENTICATION':
      return 'Facebook Page access token is invalid or expired';
    case 'AUTHORIZATION':
      return 'The Facebook app is missing a required permission';
    case 'RATE_LIMIT':
      return 'Facebook rate limit reached; will retry shortly';
    case 'TEMPORARY_PROVIDER_FAILURE':
      return 'Facebook is temporarily unavailable';
    case 'NETWORK_FAILURE':
      return 'Facebook API is temporarily unreachable';
    case 'TIMEOUT':
      return 'Facebook API request timed out';
    case 'INVALID_RECIPIENT':
      return 'Cannot message this recipient (outside the allowed window)';
    case 'INVALID_REQUEST':
      return 'Facebook rejected the message request';
    case 'PERMANENT_PROVIDER_FAILURE':
      return 'Facebook rejected the request';
    default:
      return 'Facebook request failed';
  }
}
