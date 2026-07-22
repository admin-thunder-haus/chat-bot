import type { ChannelType } from '@prisma/client';
import type {
  NormalizedChannelEvent,
} from '../channel-provider.interface';
import type {
  InstagramMessagingEvent,
  InstagramWebhookBody,
} from './instagram.types';

const CHANNEL_TYPE: ChannelType = 'INSTAGRAM';
const PROVIDER_KEY = 'instagram';

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/**
 * Instagram timestamps arrive as unix millis in the messaging-array format but
 * as unix SECONDS in the changes-array format. Normalize both: a value below
 * ~1e12 is treated as seconds and scaled to millis.
 */
function parseTimestamp(ts: unknown): Date {
  let n = typeof ts === 'number' ? ts : typeof ts === 'string' ? Number(ts) : NaN;
  if (Number.isFinite(n) && n > 0) {
    if (n < 1e12) n *= 1000; // seconds -> millis
    const d = new Date(n);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

/**
 * Normalize a single Instagram messaging event into zero-or-one normalized
 * channel events. Pure + defensive: unknown/echo/reaction/attachment shapes
 * become `unsupported` (recorded, never processed as text); a genuine failure to
 * recognize the shape yields nothing rather than throwing.
 */
function normalizeMessagingEvent(
  m: InstagramMessagingEvent,
): NormalizedChannelEvent | null {
  const senderId = str(m.sender?.id);
  const ts = parseTimestamp(m.timestamp);

  // Read receipt (references a previously-sent message id).
  if (m.read) {
    const mid = str(m.read.mid);
    if (!mid) return null;
    return {
      kind: 'read_receipt',
      providerKey: PROVIDER_KEY,
      externalEventId: `${mid}:read`,
      externalMessageId: mid,
      timestamp: ts,
    };
  }

  if (m.message) {
    const mid = str(m.message.mid);
    // Echoes are the business's own outbound copies — recorded, not ingested.
    if (m.message.is_echo === true) {
      return {
        kind: 'unsupported',
        providerKey: PROVIDER_KEY,
        externalEventId: mid ? `${mid}:echo` : null,
        eventType: 'message.echo',
        timestamp: ts,
      };
    }
    if (!mid || !senderId) return null;

    const text = str(m.message.text);
    const isPlainText =
      typeof text === 'string' &&
      (!m.message.attachments || m.message.attachments.length === 0) &&
      m.message.is_deleted !== true;

    if (isPlainText) {
      return {
        kind: 'incoming_message',
        providerKey: PROVIDER_KEY,
        channelType: CHANNEL_TYPE,
        externalEventId: mid,
        externalMessageId: mid,
        externalConversationId: null,
        customer: {
          externalCustomerId: senderId,
          username: null,
          fullName: null,
        },
        content: text,
        timestamp: ts,
        replyToExternalMessageId: str(m.message.reply_to?.mid) ?? null,
        metadata: { messageType: 'text' },
      };
    }

    // Media / share / story mention / deletion / etc. — architecture-ready,
    // recorded as unsupported (never processed yet).
    const kind = m.message.is_deleted
      ? 'deleted'
      : (m.message.attachments?.[0]?.type ?? 'unknown');
    return {
      kind: 'unsupported',
      providerKey: PROVIDER_KEY,
      externalEventId: mid,
      eventType: `message.${kind}`,
      timestamp: ts,
    };
  }

  if (m.reaction) {
    const mid = str(m.reaction.mid);
    return {
      kind: 'unsupported',
      providerKey: PROVIDER_KEY,
      externalEventId: mid ? `${mid}:reaction` : null,
      eventType: 'reaction',
      timestamp: ts,
    };
  }

  if (m.postback) {
    const mid = str(m.postback.mid);
    return {
      kind: 'unsupported',
      providerKey: PROVIDER_KEY,
      externalEventId: mid ? `${mid}:postback` : null,
      eventType: 'postback',
      timestamp: ts,
    };
  }

  // Unknown/future messaging shape — safely ignored.
  return null;
}

/**
 * Normalize a full Instagram webhook body into a list of normalized events.
 * Non-instagram objects are ignored. Never throws on unknown/extra fields.
 */
export function normalizeInstagramWebhook(
  rawBody: unknown,
): NormalizedChannelEvent[] {
  const body = (rawBody ?? {}) as InstagramWebhookBody;
  if (body.object && body.object !== 'instagram') return [];

  const events: NormalizedChannelEvent[] = [];
  for (const entry of body.entry ?? []) {
    // Messenger-style events.
    for (const messaging of entry?.messaging ?? []) {
      if (!messaging || typeof messaging !== 'object') continue;
      const normalized = normalizeMessagingEvent(messaging);
      if (normalized) events.push(normalized);
    }
    // Changes-style events (Instagram API with Instagram Login). The `value`
    // has the same sender/recipient/message shape as a messaging event.
    for (const change of entry?.changes ?? []) {
      if (change?.field && change.field !== 'messages') continue;
      const value = change?.value;
      if (!value || typeof value !== 'object') continue;
      const normalized = normalizeMessagingEvent(value);
      if (normalized) events.push(normalized);
    }
  }
  return events;
}
