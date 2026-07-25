import type { ChannelAccount, ChannelType, Conversation } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import { conversationsRepository } from '../conversations/conversations.repository';
import { channelsRepository } from './channels.repository';
import { channelRegistry } from './channel-registry';
import type { ChannelProvider } from './providers/channel-provider.interface';

/**
 * The ONE place that answers "which channel account + provider delivers an
 * outbound message for this conversation?". Both outgoing paths (the manual /
 * agent pipeline and the AI reply path) use it, so they can never disagree.
 *
 * It is fully provider-independent: no platform branching, only the generic
 * channel account + capability matrix.
 */

export interface OutboundTarget {
  account: ChannelAccount;
  provider: ChannelProvider;
}

/** Machine-readable code clients/tests branch on. */
export const CHANNEL_NOT_CONNECTED_CODE = 'CHANNEL_NOT_CONNECTED';

/**
 * Channel types whose ONLY transport is a remote provider API: if the provider
 * does not accept the message, nothing ever reaches the customer. WEBCHAT /
 * MANUAL / EMAIL are pull/local channels where persisting the message *is* the
 * delivery, so they keep the local persist path.
 */
export const PUSH_CHANNEL_TYPES: readonly ChannelType[] = [
  'WHATSAPP',
  'FACEBOOK',
  'INSTAGRAM',
  'TELEGRAM',
];

export function isPushChannel(channelType: ChannelType): boolean {
  return PUSH_CHANNEL_TYPES.includes(channelType);
}

/**
 * Raised instead of persisting a fake "SENT" message on a push channel that has
 * no deliverable account (e.g. the channel was disconnected/reconnected).
 */
export function channelNotConnectedError(): AppError {
  return AppError.badRequest(
    'This channel is not connected. Reconnect it in Channels to reply.',
    [],
    CHANNEL_NOT_CONNECTED_CODE,
  );
}

export function isChannelNotConnectedError(err: unknown): boolean {
  return err instanceof AppError && err.code === CHANNEL_NOT_CONNECTED_CODE;
}

/** A provider that can actually deliver an outbound text message. */
function deliverableProvider(providerKey: string | null): ChannelProvider | null {
  if (!providerKey) return null;
  const provider = channelRegistry.tryGet(providerKey);
  if (!provider) return null;
  return provider.capabilities.outboundMessaging &&
    provider.capabilities.textMessages
    ? provider
    : null;
}

/**
 * Resolve the account + provider an outbound message must go through.
 *
 * 1. Use `conversation.channelAccountId` when it still resolves to an enabled
 *    account (the normal case).
 * 2. Otherwise fall back to the company's best CONNECTED + enabled account for
 *    the conversation's provider (or channel type when `providerKey` is null)
 *    and PERSIST the link back onto the conversation, so the conversation
 *    self-heals. This is what makes reconnected channels work again: hard
 *    deleting a channel nulls `Conversation.channelAccountId`
 *    (`onDelete: SetNull`), orphaning every existing conversation.
 *    The channel-type fallback only applies to PUSH channels; a provider-less
 *    MANUAL / WEBCHAT / EMAIL conversation is never adopted by an account that
 *    merely shares its channel type.
 * 3. Return null when there is no provider account at all (legacy/manual and
 *    webchat conversations without an account) — callers keep the local path.
 */
export async function resolveOutboundTarget(
  companyId: string,
  conversation: Conversation,
): Promise<OutboundTarget | null> {
  if (conversation.channelAccountId) {
    const account = await channelsRepository.findByIdScoped(
      companyId,
      conversation.channelAccountId,
    );
    if (account?.isEnabled) {
      const provider = deliverableProvider(
        conversation.providerKey ?? account.providerKey,
      );
      if (provider) {
        // Backfill a missing providerKey so the link is complete going forward.
        if (!conversation.providerKey) {
          await persistLink(companyId, conversation, account, 'providerKey');
        }
        return { account, provider };
      }
    }
  }

  // A `providerKey` is an explicit provider binding, so it is always safe to
  // re-resolve. Without one, only PUSH channels are matched by channel type:
  // MANUAL / WEBCHAT / EMAIL conversations that were never bound to a provider
  // must keep the local path (a MANUAL conversation must never be adopted by an
  // unrelated account that merely shares its channel type).
  const filter = conversation.providerKey
    ? { providerKey: conversation.providerKey }
    : isPushChannel(conversation.channelType)
      ? { channelType: conversation.channelType }
      : null;
  if (!filter) return null;

  const fallback = await channelsRepository.findBestConnectedAccount(
    companyId,
    filter,
  );
  if (!fallback) return null;
  const provider = deliverableProvider(fallback.providerKey);
  if (!provider) return null;

  await persistLink(companyId, conversation, fallback, 'account');
  return { account: fallback, provider };
}

/** Persist the resolved link so the next send resolves on the fast path. */
async function persistLink(
  companyId: string,
  conversation: Conversation,
  account: ChannelAccount,
  kind: 'account' | 'providerKey',
): Promise<void> {
  await conversationsRepository.linkChannelAccount(companyId, conversation.id, {
    channelAccountId: account.id,
    providerKey: account.providerKey,
  });
  // Mutate the in-memory copy so the caller's conversation reflects the link.
  conversation.channelAccountId = account.id;
  conversation.providerKey = account.providerKey;
  logger.info('channel.outbound.relinked', {
    companyId,
    conversationId: conversation.id,
    channelAccountId: account.id,
    providerKey: account.providerKey,
    kind,
  });
}
