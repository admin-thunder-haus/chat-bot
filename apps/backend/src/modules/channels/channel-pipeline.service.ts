import { Prisma } from '@prisma/client';
import type {
  ChannelType,
  Conversation,
  Message,
  MessageSenderType,
} from '@prisma/client';
import { prisma } from '../../config/prisma';
import { logActivity } from '../../utils/activity';
import { messagesRepository } from '../messages/messages.repository';
import { conversationsRepository } from '../conversations/conversations.repository';
import { aiService } from '../ai/ai.service';
import { channelsRepository } from './channels.repository';
import { channelRegistry } from './channel-registry';
import { channelDeliveryService } from './channel-delivery.service';
import type { NormalizedInboundMessage } from './channel-normalizer.service';
import { detectLanguage } from '../../utils/language-detect';
import { emitDomainEvent } from '../events/domain-events.service';

export interface IngestInboundParams {
  companyId: string;
  channelType: ChannelType;
  channelAccountId?: string | null;
  providerKey?: string | null;
  actorUserId?: string | null;
  /** Free-text source label used only in safe activity metadata. */
  source: string;
  message: NormalizedInboundMessage;
}

export interface IngestInboundResult {
  idempotent: boolean;
  messageId: string;
  conversationId: string;
  customerId: string;
  createdConversation: boolean;
  reopened: boolean;
}

export interface SendOutboundParams {
  companyId: string;
  conversation: Conversation;
  senderUserId: string | null;
  senderType: MessageSenderType;
  content: string;
  /**
   * Optional image attachment. Silently dropped (text-only fallback) when the
   * resolved provider does not support media messages.
   */
  mediaUrl?: string | null;
  replyToMessageId?: string | null;
  actorUserId?: string | null;
}

export interface SendOutboundResult {
  message: Message;
  viaProvider: boolean;
  delivered: boolean;
}

/**
 * The one shared pipeline every channel flows through. It contains NO
 * platform-specific logic — providers handle that. Conversation/Message logic is
 * reused from the existing repositories so there is a single source of truth for
 * find-or-create, unread accounting, reopen, and activity.
 */
export const channelPipelineService = {
  /**
   * Shared incoming pipeline: find-or-create customer + conversation, append the
   * inbound message, bump unread/timestamps, reopen if needed, record activity —
   * atomically. Idempotent on (companyId, externalMessageId). Duplicate events
   * never create duplicate customers/messages (and therefore never a duplicate
   * AI reply, since auto-reply only runs for freshly-created messages).
   */
  async ingestInbound(
    params: IngestInboundParams,
  ): Promise<IngestInboundResult> {
    const { companyId, channelType, message } = params;

    // Fast path: message already processed.
    const existing = await messagesRepository.findByExternalId(
      companyId,
      message.externalMessageId,
    );
    if (existing) {
      return this.describeExisting(companyId, existing.id, true);
    }

    try {
      // Automatic language detection: channel-agnostic, runs once for every
      // inbound message. 'unknown' never overwrites a previous detection.
      const detectedLanguage = detectLanguage(message.content);

      const result = await prisma.$transaction(async (tx) => {
        const now = message.timestamp ?? new Date();

        // 1. Find or create the customer.
        let customer = await tx.customer.findFirst({
          where: {
            companyId,
            channelType,
            externalId: message.externalCustomerId,
          },
        });
        let createdCustomer = false;
        if (!customer) {
          createdCustomer = true;
          customer = await tx.customer.create({
            data: {
              companyId,
              channelType,
              externalId: message.externalCustomerId,
              fullName: message.customer.fullName,
              firstName: message.customer.firstName,
              lastName: message.customer.lastName,
              phone: message.customer.phone,
              email: message.customer.email,
              username: message.customer.username,
              preferredLanguage:
                detectedLanguage !== 'unknown' ? detectedLanguage : null,
              firstSeenAt: now,
              lastSeenAt: now,
            },
          });
        } else {
          // Backfill a name/username if the customer had none and one is now
          // known (e.g. a later profile lookup succeeded). Never overwrite an
          // existing value.
          await tx.customer.update({
            where: { id: customer.id },
            data: {
              lastSeenAt: now,
              ...(!customer.fullName && message.customer.fullName
                ? { fullName: message.customer.fullName }
                : {}),
              ...(!customer.username && message.customer.username
                ? { username: message.customer.username }
                : {}),
              // Follow the customer's latest language (mixed conversations
              // track the most recent message).
              ...(detectedLanguage !== 'unknown'
                ? { preferredLanguage: detectedLanguage }
                : {}),
            },
          });
        }

        // 2. Find an active conversation, else create one (linking the channel
        //    account when this event came from a real channel).
        let conversation = await tx.conversation.findFirst({
          where: {
            companyId,
            customerId: customer.id,
            channelType,
            isArchived: false,
          },
          orderBy: { lastMessageAt: 'desc' },
        });
        let createdConversation = false;
        if (!conversation) {
          conversation = await tx.conversation.create({
            data: {
              companyId,
              customerId: customer.id,
              channelType,
              channelAccountId: params.channelAccountId ?? null,
              providerKey: params.providerKey ?? null,
              externalConversationId: message.externalConversationId,
              status: 'OPEN',
            },
          });
          createdConversation = true;
          await logActivity(tx, {
            companyId,
            conversationId: conversation.id,
            actorUserId: params.actorUserId ?? null,
            activityType: 'CONVERSATION_CREATED',
            metadata: { source: params.source },
          });
        }

        // 3. Create the inbound message (RECEIVED).
        const created = await messagesRepository.create(tx, companyId, {
          conversationId: conversation.id,
          customerId: customer.id,
          direction: 'INBOUND',
          senderType: 'CUSTOMER',
          contentType: message.contentType ?? 'TEXT',
          content: message.content,
          mediaUrl: message.mediaUrl ?? null,
          status: 'RECEIVED',
          externalMessageId: message.externalMessageId,
          sentAt: now,
        });

        // 4. Update conversation: unread++, timestamps, reopen if needed.
        const reopen =
          conversation.status === 'RESOLVED' ||
          conversation.status === 'CLOSED';
        await tx.conversation.update({
          where: { id: conversation.id },
          data: {
            lastMessageAt: now,
            lastInboundMessageAt: now,
            unreadCount: { increment: 1 },
            ...(detectedLanguage !== 'unknown' ? { detectedLanguage } : {}),
            ...(reopen
              ? { status: 'OPEN', resolvedAt: null, closedAt: null }
              : {}),
          },
        });

        // 5. Activity for the inbound message.
        await logActivity(tx, {
          companyId,
          conversationId: conversation.id,
          actorUserId: null, // customer-originated
          activityType: 'MESSAGE_RECEIVED',
          metadata: {
            messageId: created.id,
            reopened: reopen,
            createdConversation,
            source: params.source,
          },
        });

        return {
          messageId: created.id,
          conversationId: conversation.id,
          customerId: customer.id,
          customerName: customer.fullName,
          createdConversation,
          createdCustomer,
          reopened: reopen,
        };
      });

      // Day 12: domain events AFTER the transaction commits. emitDomainEvent
      // never throws, so ingestion is never affected.
      const customerLabel = result.customerName ?? 'a customer';
      if (result.createdConversation) {
        await emitDomainEvent({
          companyId,
          type: 'conversation.created',
          title: `New ${channelType} conversation`,
          body: `${customerLabel} started a new conversation on ${channelType}`,
          data: {
            conversationId: result.conversationId,
            customerId: result.customerId,
            channelType,
          },
          notify: { type: 'NEW_CONVERSATION' },
        });
      }
      if (result.createdCustomer) {
        // Webhook-only (no in-app notification): notify is undefined.
        await emitDomainEvent({
          companyId,
          type: 'customer.created',
          title: 'New customer',
          body: `${customerLabel} contacted you for the first time on ${channelType}`,
          data: { customerId: result.customerId, channelType },
        });
      }

      return {
        idempotent: false,
        messageId: result.messageId,
        conversationId: result.conversationId,
        customerId: result.customerId,
        createdConversation: result.createdConversation,
        reopened: result.reopened,
      };
    } catch (err) {
      // Concurrent duplicate: unique (companyId, externalMessageId) violated.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const dup = await messagesRepository.findByExternalId(
          companyId,
          message.externalMessageId,
        );
        if (dup) return this.describeExisting(companyId, dup.id, true);
      }
      throw err;
    }
  },

  async describeExisting(
    companyId: string,
    messageId: string,
    idempotent: boolean,
  ): Promise<IngestInboundResult> {
    const msg = await prisma.message.findFirst({
      where: { id: messageId, companyId },
      select: { id: true, conversationId: true, customerId: true },
    });
    return {
      idempotent,
      messageId,
      conversationId: msg?.conversationId ?? '',
      customerId: msg?.customerId ?? '',
      createdConversation: false,
      reopened: false,
    };
  },

  /**
   * Optional AI auto-reply for a freshly-stored inbound message. Extracted so
   * both the mock tool and the webhook engine share one implementation. Runs
   * AFTER the inbound transaction commits and NEVER throws — provider/quota
   * failures leave the inbound message intact (they are recorded as a FAILED
   * generation inside the AI service).
   */
  async maybeAutoReply(
    companyId: string,
    messageId: string,
  ): Promise<{ generated: boolean; reason?: string }> {
    const inbound = await prisma.message.findFirst({
      where: { id: messageId, companyId },
      select: { conversationId: true, customerId: true, content: true },
    });
    if (!inbound?.customerId) {
      return { generated: false, reason: 'not_attempted' };
    }
    const conversation = await conversationsRepository.findDetail(
      companyId,
      inbound.conversationId,
    );
    const customer = await prisma.customer.findFirst({
      where: { id: inbound.customerId, companyId },
    });
    if (!conversation || !customer) {
      return { generated: false, reason: 'not_attempted' };
    }
    const outcome = await aiService.autoReplyForInbound({
      companyId,
      conversation,
      sourceMessageId: messageId,
      question: inbound.content,
      customer,
    });
    return { generated: outcome.generated, reason: outcome.reason };
  },

  /**
   * Shared outgoing pipeline. Manual/legacy conversations (no channel account)
   * send locally exactly as in Day 3. Conversations bound to an enabled provider
   * that supports outbound text are dispatched through the provider, creating a
   * ChannelDelivery and recording transport outcome — without ever blocking on
   * the provider call inside a DB transaction.
   */
  async sendOutbound(params: SendOutboundParams): Promise<SendOutboundResult> {
    const { companyId, conversation } = params;

    const account =
      conversation.channelAccountId && conversation.providerKey
        ? await channelsRepository.findByIdScoped(
            companyId,
            conversation.channelAccountId,
          )
        : null;
    const provider = conversation.providerKey
      ? channelRegistry.tryGet(conversation.providerKey)
      : null;
    const viaProvider =
      !!account &&
      account.isEnabled &&
      !!provider &&
      provider.capabilities.outboundMessaging &&
      provider.capabilities.textMessages;

    if (!viaProvider) {
      // --- Local path (Day 3 behavior, unchanged) ---
      const message = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const created = await messagesRepository.create(tx, companyId, {
          conversationId: conversation.id,
          customerId: conversation.customerId,
          senderUserId: params.senderUserId,
          direction: 'OUTBOUND',
          senderType: params.senderType,
          contentType: params.mediaUrl ? 'IMAGE' : 'TEXT',
          content: params.content,
          mediaUrl: params.mediaUrl ?? null,
          status: 'SENT',
          sentAt: now,
          replyToMessageId: params.replyToMessageId ?? null,
        });
        await conversationsRepository.updateById(tx, conversation.id, {
          lastMessageAt: now,
          lastOutboundMessageAt: now,
        });
        await logActivity(tx, {
          companyId,
          conversationId: conversation.id,
          actorUserId: params.senderUserId,
          activityType: 'MESSAGE_SENT',
          metadata: { messageId: created.id },
        });
        return created;
      });
      return { message, viaProvider: false, delivered: true };
    }

    // --- Provider path: delegate to the central delivery engine ---
    // The engine persists the message + a QUEUED delivery, runs the first
    // attempt (claiming atomically), records the attempt + health, and schedules
    // a retry on a temporary failure — all provider-independent.
    const message = await channelDeliveryService.dispatchOutbound({
      companyId,
      conversation,
      account: account!,
      senderUserId: params.senderUserId,
      senderType: params.senderType,
      content: params.content,
      // Media capability gate: unsupported providers fall back to text-only.
      mediaUrl:
        params.mediaUrl && provider!.capabilities.mediaMessages
          ? params.mediaUrl
          : null,
      replyToMessageId: params.replyToMessageId ?? null,
      actorUserId: params.actorUserId ?? params.senderUserId,
    });

    const delivered = message.status === 'SENT';
    return { message, viaProvider: true, delivered };
  },
};
