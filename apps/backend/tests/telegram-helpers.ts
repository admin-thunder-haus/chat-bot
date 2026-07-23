import request from 'supertest';
import type { Application } from 'express';
import { authHeader } from './helpers';
import { channelCredentialsService, type TelegramTransport } from '../src/modules/channels';

/** Known test bot + user (never real). */
export const TG = {
  botToken: '123456789:AAtesttesttesttesttesttesttesttest',
  botId: '123456789',
  botUsername: 'acme_support_bot',
  botName: 'Acme Support',
  chatId: '55667788', // private chat id == user id
  userFirst: 'Ahmad',
  userLast: 'Jomhawi',
  userName: 'ahmad_jomhawe',
};

export function makeTelegramTransport(
  overrides: {
    send?: () => { status: number; ok: boolean; json: unknown };
    getMe?: () => { status: number; ok: boolean; json: unknown };
    setWebhook?: () => { status: number; ok: boolean; json: unknown };
    getFile?: () => { status: number; ok: boolean; json: unknown };
  } = {},
): { transport: TelegramTransport; calls: { method: string; url: string }[] } {
  const calls: { method: string; url: string }[] = [];
  const transport: TelegramTransport = {
    async request(input) {
      calls.push({ method: input.method, url: input.url });
      if (input.url.includes('/getFile')) {
        return (
          overrides.getFile?.() ?? {
            status: 200,
            ok: true,
            json: { ok: true, result: { file_path: 'voice/file_1.oga' } },
          }
        );
      }
      if (input.url.includes('/getMe')) {
        return (
          overrides.getMe?.() ?? {
            status: 200,
            ok: true,
            json: { ok: true, result: { id: Number(TG.botId), is_bot: true, first_name: TG.botName, username: TG.botUsername } },
          }
        );
      }
      if (input.url.includes('/setWebhook')) {
        return overrides.setWebhook?.() ?? { status: 200, ok: true, json: { ok: true, result: true } };
      }
      // sendMessage
      return (
        overrides.send?.() ?? {
          status: 200,
          ok: true,
          json: { ok: true, result: { message_id: Math.floor(Math.random() * 1e6) } },
        }
      );
    },
  };
  return { transport, calls };
}

export function connectTelegram(
  app: Application,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  return request(app)
    .post('/api/v1/channels/telegram/connect')
    .set(authHeader(token))
    .send({ displayName: 'Telegram', botToken: TG.botToken, ...overrides });
}

/** The webhook secret is generated server-side; read it back to sign webhooks. */
export async function telegramSecret(companyId: string, accountId: string): Promise<string> {
  const creds = (await channelCredentialsService.load(companyId, accountId)) as {
    secretToken: string;
  };
  return creds.secretToken;
}

/** POST a Telegram webhook Update with the secret-token header. */
export function tgWebhook(
  app: Application,
  channelAccountId: string,
  body: unknown,
  secretToken: string | null,
) {
  const req = request(app)
    .post(`/api/v1/webhooks/telegram/${channelAccountId}`)
    .set('Content-Type', 'application/json');
  if (secretToken) req.set('x-telegram-bot-api-secret-token', secretToken);
  return req.send(JSON.stringify(body));
}

/** Build a Telegram voice-note Update. */
export function tgVoiceUpdate(opts: {
  updateId: number;
  messageId: number;
  fileId?: string;
  duration?: number;
  chatId?: string;
}) {
  const chatId = Number(opts.chatId ?? TG.chatId);
  return {
    update_id: opts.updateId,
    message: {
      message_id: opts.messageId,
      from: { id: chatId, is_bot: false, first_name: TG.userFirst, last_name: TG.userLast, username: TG.userName },
      chat: { id: chatId, type: 'private', first_name: TG.userFirst },
      date: 1710000000,
      voice: {
        file_id: opts.fileId ?? 'tg-voice-file-id-1',
        file_unique_id: 'tg-voice-uniq-1',
        duration: opts.duration ?? 3,
        mime_type: 'audio/ogg',
      },
    },
  };
}

/** Build a Telegram text-message Update. */
export function tgTextUpdate(opts: { updateId: number; messageId: number; text: string; chatId?: string }) {
  const chatId = Number(opts.chatId ?? TG.chatId);
  return {
    update_id: opts.updateId,
    message: {
      message_id: opts.messageId,
      from: { id: chatId, is_bot: false, first_name: TG.userFirst, last_name: TG.userLast, username: TG.userName },
      chat: { id: chatId, type: 'private', first_name: TG.userFirst },
      date: 1710000000,
      text: opts.text,
    },
  };
}
