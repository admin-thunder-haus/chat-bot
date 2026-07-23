import type {
  Conversation,
  ConversationActivity,
  ConversationStatus,
  Prisma,
} from '@prisma/client';
import { conversationsRepository } from './conversations.repository';
import type {
  ConversationDetail,
  ConversationListRow,
} from './conversations.repository';
import { customersRepository } from '../customers/customers.repository';
import { messagesRepository } from '../messages/messages.repository';
import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';
import { logActivity } from '../../utils/activity';
import { aiService } from '../ai/ai.service';
import { paginate, type PaginatedResult } from '../../utils/pagination';
import type {
  ConversationListQuery,
  CreateConversationInput,
  UpdateConversationInput,
} from './conversations.validation';

/** Timestamp side-effects for each target status. */
function statusTimestamps(
  status: ConversationStatus,
): Prisma.ConversationUpdateInput {
  switch (status) {
    case 'OPEN':
      return { resolvedAt: null, closedAt: null };
    case 'RESOLVED':
      return { resolvedAt: new Date(), closedAt: null };
    case 'CLOSED':
      return { closedAt: new Date() };
    case 'PENDING':
    default:
      return {}; // preserve existing timestamps
  }
}

export const conversationsService = {
  async list(
    companyId: string,
    query: ConversationListQuery,
  ): Promise<PaginatedResult<ConversationListRow>> {
    const { items, total } = await conversationsRepository.list(companyId, query);
    return paginate(items, total, query.page, query.limit);
  },

  async getDetail(
    companyId: string,
    id: string,
  ): Promise<ConversationDetail> {
    const conversation = await conversationsRepository.findDetail(companyId, id);
    if (!conversation) throw AppError.notFound('Conversation not found');
    return conversation;
  },

  /** Ensure a conversation belongs to the tenant, returning it (or 404). */
  async requireScoped(companyId: string, id: string): Promise<Conversation> {
    const conversation = await conversationsRepository.findByIdScoped(companyId, id);
    if (!conversation) throw AppError.notFound('Conversation not found');
    return conversation;
  },

  /**
   * Create a manual conversation. The chosen approach: the customer must
   * already exist (created via POST /customers or the mock inbound endpoint).
   * An optional `initialMessage` is recorded as an OUTBOUND AGENT message
   * (the agent logging the first contact) — it never inflates unread count.
   */
  async create(
    companyId: string,
    actorUserId: string,
    input: CreateConversationInput,
  ): Promise<ConversationDetail> {
    const customer = await customersRepository.findByIdScoped(
      companyId,
      input.customerId,
    );
    if (!customer) {
      throw AppError.notFound('Customer not found');
    }

    const conversationId = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const conversation = await conversationsRepository.create(tx, companyId, {
        customerId: customer.id,
        channelType: customer.channelType,
        subject: input.subject ?? null,
        priority: input.priority ?? 'NORMAL',
        status: 'OPEN',
      });

      await logActivity(tx, {
        companyId,
        conversationId: conversation.id,
        actorUserId,
        activityType: 'CONVERSATION_CREATED',
        newValue: { subject: input.subject ?? null },
      });

      if (input.initialMessage) {
        await messagesRepository.create(tx, companyId, {
          conversationId: conversation.id,
          customerId: customer.id,
          senderUserId: actorUserId,
          direction: 'OUTBOUND',
          senderType: 'AGENT',
          content: input.initialMessage,
          status: 'SENT',
          sentAt: now,
        });
        await conversationsRepository.updateById(tx, conversation.id, {
          lastMessageAt: now,
          lastOutboundMessageAt: now,
        });
        await logActivity(tx, {
          companyId,
          conversationId: conversation.id,
          actorUserId,
          activityType: 'MESSAGE_SENT',
        });
      }

      return conversation.id;
    });

    return this.getDetail(companyId, conversationId);
  },

  async updateSubject(
    companyId: string,
    id: string,
    input: UpdateConversationInput,
  ): Promise<ConversationDetail> {
    await this.requireScoped(companyId, id);
    await conversationsRepository.updateScoped(companyId, id, {
      subject: input.subject,
    });
    return this.getDetail(companyId, id);
  },

  async setStatus(
    companyId: string,
    id: string,
    actorUserId: string,
    status: ConversationStatus,
  ): Promise<ConversationDetail> {
    const existing = await this.requireScoped(companyId, id);
    if (existing.status !== status) {
      await prisma.$transaction(async (tx) => {
        await conversationsRepository.updateById(tx, id, {
          status,
          ...statusTimestamps(status),
        });
        await logActivity(tx, {
          companyId,
          conversationId: id,
          actorUserId,
          activityType: 'STATUS_CHANGED',
          previousValue: { status: existing.status },
          newValue: { status },
        });
      });

      // Day 11: resolving/closing generates the AI conversation summary.
      // Best-effort — a summary failure never blocks the status change.
      if (status === 'RESOLVED' || status === 'CLOSED') {
        await aiService.trySummarizeOnClose(companyId, id, actorUserId);
      }
    }
    return this.getDetail(companyId, id);
  },

  async setPriority(
    companyId: string,
    id: string,
    actorUserId: string,
    priority: Conversation['priority'],
  ): Promise<ConversationDetail> {
    const existing = await this.requireScoped(companyId, id);
    if (existing.priority !== priority) {
      await prisma.$transaction(async (tx) => {
        await conversationsRepository.updateById(tx, id, { priority });
        await logActivity(tx, {
          companyId,
          conversationId: id,
          actorUserId,
          activityType: 'PRIORITY_CHANGED',
          previousValue: { priority: existing.priority },
          newValue: { priority },
        });
      });
    }
    return this.getDetail(companyId, id);
  },

  async setArchived(
    companyId: string,
    id: string,
    isArchived: boolean,
  ): Promise<ConversationDetail> {
    await this.requireScoped(companyId, id);
    await conversationsRepository.updateScoped(companyId, id, { isArchived });
    return this.getDetail(companyId, id);
  },

  async markRead(companyId: string, id: string): Promise<ConversationDetail> {
    await this.requireScoped(companyId, id);
    await conversationsRepository.updateScoped(companyId, id, { unreadCount: 0 });
    return this.getDetail(companyId, id);
  },

  async listActivity(
    companyId: string,
    id: string,
  ): Promise<ConversationActivity[]> {
    await this.requireScoped(companyId, id);
    return prisma.conversationActivity.findMany({
      where: { companyId, conversationId: id },
      orderBy: { createdAt: 'asc' },
    });
  },
};
