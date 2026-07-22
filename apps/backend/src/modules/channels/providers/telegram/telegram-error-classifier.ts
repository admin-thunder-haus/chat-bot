import type { TelegramApiResponse } from './telegram.types';

/**
 * Telegram Bot API error taxonomy mapped to the framework's retry semantics.
 * Telegram returns `{ ok:false, error_code, description }`; classification uses
 * `error_code` (mirrors HTTP status). No token or raw response crosses this
 * boundary.
 */
export type TelegramErrorCategory =
  | 'AUTHENTICATION' // 401 invalid bot token — permanent
  | 'AUTHORIZATION' // 403 bot blocked / not allowed — permanent
  | 'RATE_LIMIT' // 429 — transient
  | 'TEMPORARY_PROVIDER_FAILURE' // 5xx — transient
  | 'NETWORK_FAILURE' // fetch threw — transient
  | 'TIMEOUT' // aborted — transient
  | 'INVALID_REQUEST' // 400 — permanent
  | 'PERMANENT_PROVIDER_FAILURE'
  | 'UNKNOWN_PROVIDER_FAILURE';

export interface TelegramErrorClassification {
  category: TelegramErrorCategory;
  retryable: boolean;
  code: string;
}

function outcome(category: TelegramErrorCategory): { retryable: boolean; code: string } {
  switch (category) {
    case 'RATE_LIMIT':
      return { retryable: true, code: 'TG_RATE_LIMIT' };
    case 'TEMPORARY_PROVIDER_FAILURE':
      return { retryable: true, code: 'TG_TEMPORARY' };
    case 'NETWORK_FAILURE':
      return { retryable: true, code: 'TG_NETWORK' };
    case 'TIMEOUT':
      return { retryable: true, code: 'TG_TIMEOUT' };
    case 'AUTHENTICATION':
      return { retryable: false, code: 'TG_AUTH' };
    case 'AUTHORIZATION':
      return { retryable: false, code: 'TG_FORBIDDEN' };
    case 'INVALID_REQUEST':
      return { retryable: false, code: 'TG_INVALID_REQUEST' };
    case 'PERMANENT_PROVIDER_FAILURE':
      return { retryable: false, code: 'TG_PERMANENT' };
    default:
      return { retryable: false, code: 'TG_UNKNOWN' };
  }
}

/** Classify a Bot API error response (or an HTTP status when body is absent). */
export function classifyTelegram(
  status: number,
  json: unknown,
): TelegramErrorClassification {
  const body = json as TelegramApiResponse<unknown> | null;
  const code = typeof body?.error_code === 'number' ? body.error_code : status;

  let category: TelegramErrorCategory = 'UNKNOWN_PROVIDER_FAILURE';
  if (code === 401) category = 'AUTHENTICATION';
  else if (code === 403) category = 'AUTHORIZATION';
  else if (code === 429) category = 'RATE_LIMIT';
  else if (code >= 500) category = 'TEMPORARY_PROVIDER_FAILURE';
  else if (code === 400) category = 'INVALID_REQUEST';
  else if (code >= 400) category = 'PERMANENT_PROVIDER_FAILURE';

  const { retryable, code: safeCode } = outcome(category);
  return { category, retryable, code: safeCode };
}

export function classifyTelegramThrow(err: unknown): TelegramErrorClassification {
  const isAbort =
    err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message));
  const category: TelegramErrorCategory = isAbort ? 'TIMEOUT' : 'NETWORK_FAILURE';
  const { retryable, code } = outcome(category);
  return { category, retryable, code };
}

export function safeTelegramReason(category: TelegramErrorCategory): string {
  switch (category) {
    case 'AUTHENTICATION':
      return 'Telegram bot token is invalid';
    case 'AUTHORIZATION':
      return 'The bot is blocked or not permitted to message this chat';
    case 'RATE_LIMIT':
      return 'Telegram rate limit reached; will retry shortly';
    case 'TEMPORARY_PROVIDER_FAILURE':
      return 'Telegram is temporarily unavailable';
    case 'NETWORK_FAILURE':
      return 'Telegram API is temporarily unreachable';
    case 'TIMEOUT':
      return 'Telegram API request timed out';
    case 'INVALID_REQUEST':
      return 'Telegram rejected the message request';
    default:
      return 'Telegram request failed';
  }
}
