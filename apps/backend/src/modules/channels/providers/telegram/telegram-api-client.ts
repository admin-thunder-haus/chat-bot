import { env } from '../../../../config/env';
import {
  classifyTelegram,
  classifyTelegramThrow,
  safeTelegramReason,
  type TelegramErrorCategory,
} from './telegram-error-classifier';
import type {
  TelegramApiResponse,
  TelegramGetFileResult,
  TelegramGetMeResult,
  TelegramSendResult,
} from './telegram.types';

/**
 * Injectable transport over the Telegram Bot API. The bot token lives in the URL
 * PATH (Telegram has no auth header), so the URL is built by the caller and must
 * never be logged. Tests inject a fake so the real network is never hit.
 */
export interface TelegramHttpRequest {
  url: string;
  method: 'GET' | 'POST';
  body?: unknown;
  timeoutMs: number;
}

export interface TelegramHttpResponse {
  status: number;
  ok: boolean;
  json: unknown;
}

export interface TelegramTransport {
  request(input: TelegramHttpRequest): Promise<TelegramHttpResponse>;
}

const defaultTransport: TelegramTransport = {
  async request(input) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const res = await fetch(input.url, {
        method: input.method,
        headers: input.body !== undefined ? { 'Content-Type': 'application/json' } : {},
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

let transport: TelegramTransport = defaultTransport;

/** Test hook: inject a fake transport (null restores the real one). */
export function setTelegramTransportForTesting(t: TelegramTransport | null): void {
  transport = t ?? defaultTransport;
}

export interface TelegramSendOutcome {
  ok: boolean;
  externalMessageId?: string | null;
  category?: TelegramErrorCategory;
  retryable?: boolean;
  code?: string;
  reason?: string;
}

export interface TelegramConnectionOutcome {
  state: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'AUTH_EXPIRED';
  code?: string | null;
  reason?: string | null;
  botId?: string | null;
  botUsername?: string | null;
  botName?: string | null;
}

/** Build a Bot API method URL. The token is in the path — never log this. */
function methodUrl(botToken: string, method: string): string {
  return `${env.TELEGRAM_API_BASE_URL}/bot${botToken}/${method}`;
}

function stateFromCategory(
  category: TelegramErrorCategory,
): TelegramConnectionOutcome['state'] {
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

export const telegramApiClient = {
  /** Send a text message to a chat. Never throws. */
  async sendText(input: {
    botToken: string;
    chatId: string;
    text: string;
    replyToMessageId?: string | null;
  }): Promise<TelegramSendOutcome> {
    const body: Record<string, unknown> = { chat_id: input.chatId, text: input.text };
    const replyId = input.replyToMessageId ? Number(input.replyToMessageId) : NaN;
    if (Number.isFinite(replyId)) body.reply_to_message_id = replyId;
    try {
      const res = await transport.request({
        url: methodUrl(input.botToken, 'sendMessage'),
        method: 'POST',
        body,
        timeoutMs: env.TELEGRAM_API_TIMEOUT_MS,
      });
      const json = res.json as TelegramApiResponse<TelegramSendResult> | null;
      if (res.ok && json?.ok) {
        const id = json.result?.message_id;
        return { ok: true, externalMessageId: id != null ? String(id) : null };
      }
      const c = classifyTelegram(res.status, res.json);
      return { ok: false, category: c.category, retryable: c.retryable, code: c.code, reason: safeTelegramReason(c.category) };
    } catch (err) {
      const c = classifyTelegramThrow(err);
      return { ok: false, category: c.category, retryable: c.retryable, code: c.code, reason: safeTelegramReason(c.category) };
    }
  },

  /** Send a photo (by public URL) with an optional caption. Never throws. */
  async sendPhoto(input: {
    botToken: string;
    chatId: string;
    photoUrl: string;
    caption?: string | null;
    replyToMessageId?: string | null;
  }): Promise<TelegramSendOutcome> {
    const body: Record<string, unknown> = {
      chat_id: input.chatId,
      photo: input.photoUrl,
      ...(input.caption ? { caption: input.caption } : {}),
    };
    const replyId = input.replyToMessageId ? Number(input.replyToMessageId) : NaN;
    if (Number.isFinite(replyId)) body.reply_to_message_id = replyId;
    try {
      const res = await transport.request({
        url: methodUrl(input.botToken, 'sendPhoto'),
        method: 'POST',
        body,
        timeoutMs: env.TELEGRAM_API_TIMEOUT_MS,
      });
      const json = res.json as TelegramApiResponse<TelegramSendResult> | null;
      if (res.ok && json?.ok) {
        const id = json.result?.message_id;
        return { ok: true, externalMessageId: id != null ? String(id) : null };
      }
      const c = classifyTelegram(res.status, res.json);
      return { ok: false, category: c.category, retryable: c.retryable, code: c.code, reason: safeTelegramReason(c.category) };
    } catch (err) {
      const c = classifyTelegramThrow(err);
      return { ok: false, category: c.category, retryable: c.retryable, code: c.code, reason: safeTelegramReason(c.category) };
    }
  },

  /**
   * Resolve a file_id to its download path (getFile). The returned file_path is
   * appended to `/file/bot<token>/…` to download the bytes. Never throws.
   */
  async getFile(input: {
    botToken: string;
    fileId: string;
  }): Promise<{ ok: boolean; filePath?: string | null }> {
    try {
      const res = await transport.request({
        url: methodUrl(input.botToken, 'getFile'),
        method: 'POST',
        body: { file_id: input.fileId },
        timeoutMs: env.TELEGRAM_API_TIMEOUT_MS,
      });
      const json = res.json as TelegramApiResponse<TelegramGetFileResult> | null;
      if (res.ok && json?.ok) {
        return { ok: true, filePath: json.result?.file_path ?? null };
      }
      return { ok: false };
    } catch {
      return { ok: false };
    }
  },

  /** Validate the bot token via getMe. Never throws. */
  async getMe(input: { botToken: string }): Promise<TelegramConnectionOutcome> {
    try {
      const res = await transport.request({
        url: methodUrl(input.botToken, 'getMe'),
        method: 'GET',
        timeoutMs: env.TELEGRAM_API_TIMEOUT_MS,
      });
      const json = res.json as TelegramApiResponse<TelegramGetMeResult> | null;
      if (res.ok && json?.ok) {
        const r = json.result;
        return {
          state: 'HEALTHY',
          botId: r?.id != null ? String(r.id) : null,
          botUsername: r?.username ?? null,
          botName: r?.first_name ?? null,
        };
      }
      const c = classifyTelegram(res.status, res.json);
      return { state: stateFromCategory(c.category), code: c.code, reason: safeTelegramReason(c.category) };
    } catch (err) {
      const c = classifyTelegramThrow(err);
      return { state: 'UNAVAILABLE', code: c.code, reason: safeTelegramReason(c.category) };
    }
  },

  /**
   * Register (or clear) the bot's webhook. Telegram pushes updates to `url` and
   * echoes `secretToken` in the X-Telegram-Bot-Api-Secret-Token header. Returns
   * a safe {ok, reason} — never throws.
   */
  async setWebhook(input: {
    botToken: string;
    url: string;
    secretToken: string;
  }): Promise<{ ok: boolean; reason?: string }> {
    try {
      const res = await transport.request({
        url: methodUrl(input.botToken, 'setWebhook'),
        method: 'POST',
        body: {
          url: input.url,
          secret_token: input.secretToken,
          allowed_updates: ['message'],
          drop_pending_updates: true,
        },
        timeoutMs: env.TELEGRAM_API_TIMEOUT_MS,
      });
      const json = res.json as TelegramApiResponse<boolean> | null;
      if (res.ok && json?.ok) return { ok: true };
      const c = classifyTelegram(res.status, res.json);
      return { ok: false, reason: safeTelegramReason(c.category) };
    } catch (err) {
      const c = classifyTelegramThrow(err);
      return { ok: false, reason: safeTelegramReason(c.category) };
    }
  },
};
