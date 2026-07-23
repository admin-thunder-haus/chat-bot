import type { ChannelType } from '@prisma/client';
import type { NormalizedChannelEvent } from '../channel-provider.interface';
import type { TelegramMessage, TelegramUpdate } from './telegram.types';

const CHANNEL_TYPE: ChannelType = 'TELEGRAM';
const PROVIDER_KEY = 'telegram';

function str(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function parseTimestamp(ts: unknown): Date {
  const n = typeof ts === 'number' ? ts : typeof ts === 'string' ? Number(ts) : NaN;
  if (Number.isFinite(n) && n > 0) {
    const d = new Date(n * 1000); // Telegram dates are unix seconds
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function fullName(m: TelegramMessage): string | null {
  const first = m.from?.first_name ?? m.chat?.first_name;
  const last = m.from?.last_name ?? m.chat?.last_name;
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name || null;
}

function normalizeMessage(
  m: TelegramMessage,
  updateId: number | undefined,
): NormalizedChannelEvent | null {
  const messageId = str(m.message_id);
  // The chat id is the send target (equals the user id for private chats).
  const chatId = str(m.chat?.id);
  if (!messageId || !chatId) return null;

  const text = str(m.text);
  const isPlainText =
    typeof text === 'string' &&
    !m.photo &&
    !m.document &&
    !m.sticker &&
    !m.voice &&
    !m.video &&
    !m.location;

  const eventId = updateId != null ? String(updateId) : `${chatId}:${messageId}`;

  if (isPlainText) {
    return {
      kind: 'incoming_message',
      providerKey: PROVIDER_KEY,
      channelType: CHANNEL_TYPE,
      externalEventId: eventId,
      externalMessageId: messageId,
      externalConversationId: null,
      customer: {
        externalCustomerId: chatId,
        fullName: fullName(m),
        username: str(m.from?.username ?? m.chat?.username) ?? null,
      },
      content: text,
      timestamp: parseTimestamp(m.date),
      replyToExternalMessageId: str(m.reply_to_message?.message_id) ?? null,
      metadata: { messageType: 'text' },
    };
  }

  // Voice note: normalized as an audio incoming_message (content stays '').
  // The engine downloads the bytes via getFile and transcribes them later.
  if (m.voice && !text) {
    return {
      kind: 'incoming_message',
      providerKey: PROVIDER_KEY,
      channelType: CHANNEL_TYPE,
      externalEventId: eventId,
      externalMessageId: messageId,
      externalConversationId: null,
      customer: {
        externalCustomerId: chatId,
        fullName: fullName(m),
        username: str(m.from?.username ?? m.chat?.username) ?? null,
      },
      content: '',
      timestamp: parseTimestamp(m.date),
      replyToExternalMessageId: str(m.reply_to_message?.message_id) ?? null,
      media: {
        kind: 'audio',
        providerMediaId: str(m.voice.file_id) ?? null,
        mimeType: str(m.voice.mime_type) ?? null,
        durationSeconds:
          typeof m.voice.duration === 'number' ? m.voice.duration : null,
      },
      metadata: { messageType: 'voice' },
    };
  }

  // Media / stickers / location / etc. — recorded as unsupported (never crash).
  return {
    kind: 'unsupported',
    providerKey: PROVIDER_KEY,
    externalEventId: eventId,
    eventType: 'message.non_text',
    timestamp: parseTimestamp(m.date),
  };
}

/**
 * Normalize a Telegram webhook Update. Only private `message` updates are
 * processed; edited messages, channel posts, and callback queries are recorded
 * as unsupported. Never throws on unknown fields.
 */
export function normalizeTelegramWebhook(rawBody: unknown): NormalizedChannelEvent[] {
  const update = (rawBody ?? {}) as TelegramUpdate;
  if (!update || typeof update !== 'object') return [];

  if (update.message) {
    const e = normalizeMessage(update.message, update.update_id);
    return e ? [e] : [];
  }
  if (update.edited_message || update.channel_post || update.callback_query) {
    return [
      {
        kind: 'unsupported',
        providerKey: PROVIDER_KEY,
        externalEventId: update.update_id != null ? String(update.update_id) : null,
        eventType: update.edited_message
          ? 'edited_message'
          : update.channel_post
            ? 'channel_post'
            : 'callback_query',
        timestamp: new Date(),
      },
    ];
  }
  return [];
}
