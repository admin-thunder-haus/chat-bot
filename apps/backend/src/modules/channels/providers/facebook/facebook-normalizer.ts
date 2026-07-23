import type { ChannelType } from '@prisma/client';
import type { NormalizedChannelEvent } from '../channel-provider.interface';
import type {
  FacebookMessagingEvent,
  FacebookWebhookBody,
} from './facebook.types';

const CHANNEL_TYPE: ChannelType = 'FACEBOOK';
const PROVIDER_KEY = 'facebook';

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function parseTimestamp(ts: unknown): Date {
  const n = typeof ts === 'number' ? ts : typeof ts === 'string' ? Number(ts) : NaN;
  if (Number.isFinite(n) && n > 0) {
    const d = new Date(n);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

/**
 * Normalize a single Messenger event into zero-or-more normalized channel
 * events. Pure + defensive. Delivery events carry per-message `mids` (mapped to
 * delivery_status). Read events are watermark-only (no message id) and are
 * recorded as `unsupported` rather than forced onto the per-message model.
 */
function normalizeMessagingEvent(m: FacebookMessagingEvent): NormalizedChannelEvent[] {
  const senderId = str(m.sender?.id);
  const ts = parseTimestamp(m.timestamp);

  // Delivery receipt(s): one per delivered message id.
  if (m.delivery) {
    const mids = Array.isArray(m.delivery.mids) ? m.delivery.mids : [];
    return mids
      .map((mid) => str(mid))
      .filter((mid): mid is string => !!mid)
      .map((mid) => ({
        kind: 'delivery_status' as const,
        providerKey: PROVIDER_KEY,
        externalEventId: `${mid}:delivered`,
        externalMessageId: mid,
        status: 'delivered' as const,
        timestamp: ts,
      }));
  }

  // Read is watermark-based (no message id) — recorded, not processed.
  if (m.read) {
    return [
      {
        kind: 'unsupported',
        providerKey: PROVIDER_KEY,
        externalEventId: m.read.watermark ? `read:${m.read.watermark}` : null,
        eventType: 'read',
        timestamp: ts,
      },
    ];
  }

  if (m.message) {
    const mid = str(m.message.mid);
    if (m.message.is_echo === true) {
      return [
        {
          kind: 'unsupported',
          providerKey: PROVIDER_KEY,
          externalEventId: mid ? `${mid}:echo` : null,
          eventType: 'message.echo',
          timestamp: ts,
        },
      ];
    }
    if (!mid || !senderId) return [];

    const text = str(m.message.text);
    const isPlainText =
      typeof text === 'string' &&
      (!m.message.attachments || m.message.attachments.length === 0);

    if (isPlainText) {
      return [
        {
          kind: 'incoming_message',
          providerKey: PROVIDER_KEY,
          channelType: CHANNEL_TYPE,
          externalEventId: mid,
          externalMessageId: mid,
          externalConversationId: null,
          customer: { externalCustomerId: senderId, username: null, fullName: null },
          content: text,
          timestamp: ts,
          replyToExternalMessageId: str(m.message.reply_to?.mid) ?? null,
          metadata: { messageType: 'text' },
        },
      ];
    }

    // Voice note / audio attachment: normalized as an audio incoming message
    // (content stays ''). The engine downloads the CDN URL and transcribes.
    const first = m.message.attachments?.[0];
    const audioUrl = first?.type === 'audio' ? str(first.payload?.url) : undefined;
    if (audioUrl) {
      return [
        {
          kind: 'incoming_message',
          providerKey: PROVIDER_KEY,
          channelType: CHANNEL_TYPE,
          externalEventId: mid,
          externalMessageId: mid,
          externalConversationId: null,
          customer: { externalCustomerId: senderId, username: null, fullName: null },
          content: '',
          timestamp: ts,
          replyToExternalMessageId: str(m.message.reply_to?.mid) ?? null,
          media: { kind: 'audio', url: audioUrl },
          metadata: { messageType: 'audio' },
        },
      ];
    }

    const kind = first?.type ?? 'unknown';
    return [
      {
        kind: 'unsupported',
        providerKey: PROVIDER_KEY,
        externalEventId: mid,
        eventType: `message.${kind}`,
        timestamp: ts,
      },
    ];
  }

  if (m.reaction) {
    const mid = str(m.reaction.mid);
    return [
      {
        kind: 'unsupported',
        providerKey: PROVIDER_KEY,
        externalEventId: mid ? `${mid}:reaction` : null,
        eventType: 'reaction',
        timestamp: ts,
      },
    ];
  }

  if (m.postback) {
    const mid = str(m.postback.mid);
    return [
      {
        kind: 'unsupported',
        providerKey: PROVIDER_KEY,
        externalEventId: mid ? `${mid}:postback` : null,
        eventType: 'postback',
        timestamp: ts,
      },
    ];
  }

  return [];
}

/**
 * Normalize a full Messenger webhook body. Non-"page" objects are ignored. Never
 * throws on unknown/extra fields.
 */
export function normalizeFacebookWebhook(rawBody: unknown): NormalizedChannelEvent[] {
  const body = (rawBody ?? {}) as FacebookWebhookBody;
  if (body.object && body.object !== 'page') return [];

  const events: NormalizedChannelEvent[] = [];
  for (const entry of body.entry ?? []) {
    for (const messaging of entry?.messaging ?? []) {
      if (!messaging || typeof messaging !== 'object') continue;
      events.push(...normalizeMessagingEvent(messaging));
    }
  }
  return events;
}
