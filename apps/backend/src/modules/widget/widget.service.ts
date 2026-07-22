import { randomUUID } from 'node:crypto';
import type { ChannelAccount } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';
import { channelsRepository } from '../channels/channels.repository';
import { channelRegistry } from '../channels/channel-registry';
import { channelPipelineService } from '../channels/channel-pipeline.service';
import { channelNormalizerService } from '../channels/channel-normalizer.service';
import { readWebChatConfig } from '../channels/providers/webchat.config';
import { WEBCHAT_PROVIDER_KEY } from '../channels/providers/webchat-channel.provider';
import type { WebChatInboundPayload } from '../channels/providers/webchat-channel.provider';
import { widgetSessionService, type WidgetSession } from './widget-session.service';
import {
  toWidgetMessage,
  type WidgetMessage,
  type WidgetPublicConfig,
  type WidgetSessionResult,
} from './widget.types';
import type {
  StartSessionInput,
  WidgetMessageInput,
} from './widget.validation';

const HISTORY_LIMIT = 50;
const POLL_LIMIT = 50;

/**
 * Public Web Chat widget transport. It authenticates browser visitors via a
 * public widget key + a signed session token (no JWT), then feeds messages into
 * the SAME channel pipeline every provider uses — there is NO duplicate
 * conversation/message/AI logic here. Outbound agent/AI messages are simply
 * polled back by the widget.
 */
export const widgetService = {
  /** Resolve an enabled Web Chat account by its public widget key, or 404. */
  async resolveAccount(publicId: string): Promise<ChannelAccount> {
    const account = await channelsRepository.findByPublicId(publicId);
    if (
      !account ||
      account.providerKey !== WEBCHAT_PROVIDER_KEY ||
      !account.isEnabled
    ) {
      // Generic 404 — never leaks whether a key exists.
      throw AppError.notFound('Widget not found');
    }
    return account;
  },

  /** Public, non-sensitive widget configuration (no session needed). */
  async getPublicConfig(publicId: string): Promise<WidgetPublicConfig> {
    const account = await this.resolveAccount(publicId);
    return {
      publicId: account.publicId!,
      channelType: 'WEBCHAT',
      config: readWebChatConfig(account.metadata),
    };
  },

  /**
   * Start or resume a session. Priority for the visitor identity: a valid
   * session token (reconnect) → a client-supplied visitorId → a fresh id. The
   * visitor is persisted as a Customer; the conversation (if any) provides
   * history. No conversation is created until the first message is sent.
   */
  async startSession(
    publicId: string,
    input: StartSessionInput,
  ): Promise<WidgetSessionResult> {
    const account = await this.resolveAccount(publicId);
    const companyId = account.companyId;

    // Resolve visitorId (reconnect-safe).
    let visitorId: string | undefined;
    const fromToken = widgetSessionService.verify(input.sessionToken);
    if (
      fromToken &&
      fromToken.channelAccountId === account.id &&
      fromToken.companyId === companyId
    ) {
      visitorId = fromToken.visitorId;
    } else if (input.visitorId) {
      visitorId = input.visitorId;
    } else {
      visitorId = widgetSessionService.newVisitorId();
    }

    // Persist / update the visitor as a Customer (anonymous-friendly).
    const now = new Date();
    const customer = await prisma.customer.upsert({
      where: {
        companyId_channelType_externalId: {
          companyId,
          channelType: 'WEBCHAT',
          externalId: visitorId,
        },
      },
      update: {
        lastSeenAt: now,
        ...(input.visitor?.name ? { fullName: input.visitor.name } : {}),
        ...(input.visitor?.email ? { email: input.visitor.email } : {}),
      },
      create: {
        companyId,
        channelType: 'WEBCHAT',
        externalId: visitorId,
        fullName: input.visitor?.name ?? null,
        email: input.visitor?.email ?? null,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });

    const conversation = await this.activeConversation(companyId, customer.id);
    const messages = conversation
      ? await this.recentMessages(companyId, conversation.id)
      : [];

    return {
      sessionToken: widgetSessionService.issue({
        visitorId,
        companyId,
        channelAccountId: account.id,
      }),
      visitorId,
      conversationId: conversation?.id ?? null,
      config: readWebChatConfig(account.metadata),
      messages,
    };
  },

  /**
   * Inbound message from the visitor. Normalizes via the provider, runs it
   * through the shared incoming pipeline (find-or-create customer + conversation,
   * idempotent), then triggers the existing AI auto-reply — no special handling.
   */
  async postMessage(
    publicId: string,
    session: WidgetSession,
    input: WidgetMessageInput,
  ): Promise<{ message: WidgetMessage; autoReply: { generated: boolean; reason?: string } }> {
    const account = await this.resolveAccount(publicId);
    this.assertSession(session, account);
    const companyId = account.companyId;

    const provider = channelRegistry.get(WEBCHAT_PROVIDER_KEY);
    const externalMessageId = input.clientMessageId
      ? `webchat-${input.clientMessageId}`
      : `webchat-in-${randomUUID()}`;

    const rawPayload: WebChatInboundPayload = {
      externalMessageId,
      visitorId: session.visitorId,
      content: input.content,
      timestamp: new Date().toISOString(),
    };

    // Provider-specific parsing → normalized event → validated pipeline input.
    const events = await provider.parseWebhook({
      channelType: 'WEBCHAT',
      body: rawPayload,
      headers: {},
    });
    const event = events.find((e) => e.kind === 'incoming_message');
    if (!event || event.kind !== 'incoming_message') {
      throw AppError.badRequest('Invalid message');
    }
    const normalized = channelNormalizerService.normalizeIncoming(event);

    const ingest = await channelPipelineService.ingestInbound({
      companyId,
      channelType: 'WEBCHAT',
      channelAccountId: account.id,
      providerKey: WEBCHAT_PROVIDER_KEY,
      actorUserId: null,
      source: 'webchat-widget',
      message: normalized,
    });

    // Existing AI auto-reply — Web Chat messages enter the AI pipeline exactly
    // like any other channel. Never throws; gated by the same opt-in settings.
    const autoReply = ingest.idempotent
      ? { generated: false, reason: 'duplicate' }
      : await channelPipelineService.maybeAutoReply(companyId, ingest.messageId);

    const stored = await prisma.message.findFirst({
      where: { id: ingest.messageId, companyId },
      select: { id: true, direction: true, senderType: true, content: true, mediaUrl: true, createdAt: true },
    });
    if (!stored) throw AppError.internal('Message not found after ingest');
    return { message: toWidgetMessage(stored), autoReply };
  },

  /** Poll for new messages after a cursor (agent + AI replies appear here). */
  async pollMessages(
    publicId: string,
    session: WidgetSession,
    after?: string,
  ): Promise<{ messages: WidgetMessage[]; conversationId: string | null }> {
    const account = await this.resolveAccount(publicId);
    this.assertSession(session, account);
    const companyId = account.companyId;

    const customer = await prisma.customer.findFirst({
      where: { companyId, channelType: 'WEBCHAT', externalId: session.visitorId },
      select: { id: true },
    });
    if (!customer) return { messages: [], conversationId: null };
    const conversation = await this.activeConversation(companyId, customer.id);
    if (!conversation) return { messages: [], conversationId: null };

    let cursorCreatedAt: Date | undefined;
    if (after) {
      const cursor = await prisma.message.findFirst({
        where: { id: after, companyId, conversationId: conversation.id },
        select: { createdAt: true },
      });
      cursorCreatedAt = cursor?.createdAt;
    }

    const rows = await prisma.message.findMany({
      where: {
        companyId,
        conversationId: conversation.id,
        ...(cursorCreatedAt
          ? {
              OR: [
                { createdAt: { gt: cursorCreatedAt } },
                { createdAt: cursorCreatedAt, id: { gt: after } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: POLL_LIMIT,
      select: { id: true, direction: true, senderType: true, content: true, mediaUrl: true, createdAt: true },
    });
    return {
      messages: rows.map(toWidgetMessage),
      conversationId: conversation.id,
    };
  },

  /** Visitor typing signal — architecture only in Part 3 (no push transport). */
  async typing(publicId: string, session: WidgetSession): Promise<void> {
    const account = await this.resolveAccount(publicId);
    this.assertSession(session, account);
    // No-op: a future real-time transport (Part 4+) would broadcast this to the
    // inbox. Accepted here so the widget contract is stable.
  },

  // --- helpers ------------------------------------------------------------

  assertSession(session: WidgetSession, account: ChannelAccount): void {
    if (
      session.channelAccountId !== account.id ||
      session.companyId !== account.companyId
    ) {
      throw AppError.unauthorized('Invalid widget session');
    }
  },

  activeConversation(companyId: string, customerId: string) {
    return prisma.conversation.findFirst({
      where: { companyId, customerId, channelType: 'WEBCHAT', isArchived: false },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true },
    });
  },

  async recentMessages(
    companyId: string,
    conversationId: string,
  ): Promise<WidgetMessage[]> {
    const rows = await prisma.message.findMany({
      where: { companyId, conversationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_LIMIT,
      select: { id: true, direction: true, senderType: true, content: true, mediaUrl: true, createdAt: true },
    });
    return rows.reverse().map(toWidgetMessage);
  },
};
