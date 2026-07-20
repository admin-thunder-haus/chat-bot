import type { Message, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { assignedUserSelect } from '../conversations/conversations.types';

const messageInclude = {
  senderUser: { select: assignedUserSelect },
  // Day 5 Part 2: lightweight delivery snapshot for the inbox delivery badge
  // (never credentials). Null for local/manual/AI messages without a provider.
  delivery: {
    select: {
      status: true,
      failureType: true,
      attemptCount: true,
      maxAttempts: true,
      nextAttemptAt: true,
    },
  },
} satisfies Prisma.MessageInclude;

export type MessageRow = Prisma.MessageGetPayload<{
  include: typeof messageInclude;
}>;

export interface MessagePage {
  items: MessageRow[];
  hasMore: boolean;
  nextCursor: string | null;
  total: number;
}

/** Tenant-scoped data-access for messages. */
export const messagesRepository = {
  create(
    tx: Prisma.TransactionClient,
    companyId: string,
    data: Omit<Prisma.MessageUncheckedCreateInput, 'companyId'>,
  ): Promise<Message> {
    return tx.message.create({ data: { ...data, companyId } });
  },

  /**
   * Cursor-paginated message history. By default returns the LATEST `limit`
   * messages (so opening a conversation shows the newest, at the bottom). Pass
   * `before` (a message id) to load the page of OLDER messages preceding it.
   *
   * Ordering is stable: `(createdAt DESC, id DESC)` for selection, then reversed
   * to ascending for display. The id tie-break keeps equal timestamps stable and
   * gap-free across pages. Internal notes live in a separate table and are never
   * returned here.
   */
  async list(
    companyId: string,
    conversationId: string,
    limit: number,
    before?: string,
  ): Promise<MessagePage> {
    const where: Prisma.MessageWhereInput = { companyId, conversationId };

    if (before) {
      const cursor = await prisma.message.findFirst({
        where: { id: before, companyId, conversationId },
        select: { id: true, createdAt: true },
      });
      // Unknown/foreign cursor -> ignore (returns latest page) rather than leak.
      if (cursor) {
        where.OR = [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ];
      }
    }

    // Fetch one extra to detect whether older messages exist.
    const rows = await prisma.message.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: messageInclude,
    });

    const hasMore = rows.length > limit;
    const windowRows = hasMore ? rows.slice(0, limit) : rows;
    const items = windowRows.reverse(); // ascending for display
    const nextCursor = hasMore && items.length > 0 ? items[0].id : null;
    const total = await prisma.message.count({
      where: { companyId, conversationId },
    });

    return { items, hasMore, nextCursor, total };
  },

  /** Idempotency lookup for (future) webhook retries. */
  findByExternalId(
    companyId: string,
    externalMessageId: string,
  ): Promise<Message | null> {
    return prisma.message.findFirst({
      where: { companyId, externalMessageId },
    });
  },

  countForConversation(companyId: string, conversationId: string): Promise<number> {
    return prisma.message.count({ where: { companyId, conversationId } });
  },
};
