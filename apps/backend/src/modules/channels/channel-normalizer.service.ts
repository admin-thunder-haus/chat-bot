import { AppError } from '../../utils/AppError';
import { MAX_MESSAGE_LENGTH } from '../conversations/conversations.validation';
import type { NormalizedIncomingMessageEvent } from './providers/channel-provider.interface';

const MAX_EXTERNAL_ID = 191;

/** Validated, pipeline-ready inbound message (already platform-independent). */
export interface NormalizedInboundMessage {
  externalMessageId: string;
  externalConversationId: string | null;
  externalCustomerId: string;
  replyToExternalMessageId: string | null;
  customer: {
    fullName: string | null;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    email: string | null;
    username: string | null;
  };
  content: string;
  /** AUDIO for voice notes (content may then be '' until transcribed). */
  contentType?: 'TEXT' | 'AUDIO';
  /** Public URL of stored media; set post-ingest once the bytes are stored. */
  mediaUrl?: string | null;
  timestamp: Date;
}

function clean(v: string | null | undefined, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t === '') return null;
  return t.slice(0, max);
}

/**
 * Validates and normalizes a provider's incoming-message event into a strict,
 * platform-independent shape the pipeline can trust. Raw provider payloads never
 * reach the conversation/message services — only this normalized structure does.
 * Throws a safe validation error (recorded on the webhook event) when the event
 * is malformed, so bad input fails without corrupting any records.
 */
export const channelNormalizerService = {
  normalizeIncoming(
    event: NormalizedIncomingMessageEvent,
  ): NormalizedInboundMessage {
    const externalMessageId = clean(event.externalMessageId, MAX_EXTERNAL_ID);
    const externalCustomerId = clean(
      event.customer?.externalCustomerId,
      MAX_EXTERNAL_ID,
    );
    const content = clean(event.content, MAX_MESSAGE_LENGTH);
    // Voice notes legitimately arrive with empty content — the transcript is
    // filled in post-ingest. Only text messages require non-empty content.
    const isAudio = event.media?.kind === 'audio';

    if (!externalMessageId) {
      throw AppError.badRequest('Normalized event missing externalMessageId');
    }
    if (!externalCustomerId) {
      throw AppError.badRequest('Normalized event missing externalCustomerId');
    }
    if (!content && !isAudio) {
      throw AppError.badRequest('Normalized event has empty message content');
    }

    return {
      externalMessageId,
      externalConversationId: clean(event.externalConversationId, MAX_EXTERNAL_ID),
      externalCustomerId,
      replyToExternalMessageId: clean(
        event.replyToExternalMessageId,
        MAX_EXTERNAL_ID,
      ),
      customer: {
        fullName: clean(event.customer.fullName, 120),
        firstName: clean(event.customer.firstName, 80),
        lastName: clean(event.customer.lastName, 80),
        phone: clean(event.customer.phone, 30),
        email: clean(event.customer.email, 254)?.toLowerCase() ?? null,
        username: clean(event.customer.username, 120),
      },
      content: content ?? '',
      contentType: isAudio ? 'AUDIO' : 'TEXT',
      mediaUrl: null,
      timestamp: event.timestamp instanceof Date ? event.timestamp : new Date(),
    };
  },
};
