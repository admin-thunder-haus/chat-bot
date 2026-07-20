import type { Conversation, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { toSkipTake } from '../../utils/pagination';
import {
  conversationDetailInclude,
  conversationListInclude,
  type ConversationListFilters,
} from './conversations.types';

export type ConversationListRow = Prisma.ConversationGetPayload<{
  include: typeof conversationListInclude;
}>;

export type ConversationDetail = Prisma.ConversationGetPayload<{
  include: typeof conversationDetailInclude;
}>;

function buildWhere(
  companyId: string,
  filters: ConversationListFilters,
): Prisma.ConversationWhereInput {
  const where: Prisma.ConversationWhereInput = {
    companyId,
    // Archived hidden unless explicitly requested.
    isArchived: filters.archived === true,
  };

  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priority = filters.priority;
  if (filters.channelType) where.channelType = filters.channelType;
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.assignedUserId) where.assignedUserId = filters.assignedUserId;
  if (filters.unassigned) where.assignedUserId = null;
  if (filters.unreadOnly) where.unreadCount = { gt: 0 };
  if (filters.tagId) {
    where.tagAssignments = { some: { tagId: filters.tagId } };
  }
  if (filters.search) {
    const s = filters.search;
    where.OR = [
      { subject: { contains: s, mode: 'insensitive' } },
      { customer: { fullName: { contains: s, mode: 'insensitive' } } },
      { customer: { email: { contains: s, mode: 'insensitive' } } },
      { customer: { phone: { contains: s, mode: 'insensitive' } } },
      { customer: { username: { contains: s, mode: 'insensitive' } } },
      { messages: { some: { content: { contains: s, mode: 'insensitive' } } } },
    ];
  }
  return where;
}

/** Tenant-scoped data-access for conversations. */
export const conversationsRepository = {
  findByIdScoped(companyId: string, id: string): Promise<Conversation | null> {
    return prisma.conversation.findFirst({ where: { id, companyId } });
  },

  findDetail(companyId: string, id: string): Promise<ConversationDetail | null> {
    return prisma.conversation.findFirst({
      where: { id, companyId },
      include: conversationDetailInclude,
    });
  },

  async list(
    companyId: string,
    filters: ConversationListFilters,
  ): Promise<{ items: ConversationListRow[]; total: number }> {
    const where = buildWhere(companyId, filters);
    const { skip, take } = toSkipTake(filters.page, filters.limit);
    const orderBy: Prisma.ConversationOrderByWithRelationInput[] = [
      { [filters.sortBy]: filters.sortOrder },
      { id: 'desc' },
    ];

    const [items, total] = await prisma.$transaction([
      prisma.conversation.findMany({
        where,
        orderBy,
        skip,
        take,
        include: conversationListInclude,
      }),
      prisma.conversation.count({ where }),
    ]);
    return { items, total };
  },

  // --- transaction-aware writes (pass a tx client) ---

  create(
    tx: Prisma.TransactionClient,
    companyId: string,
    data: Omit<Prisma.ConversationUncheckedCreateInput, 'companyId'>,
  ): Promise<Conversation> {
    return tx.conversation.create({ data: { ...data, companyId } });
  },

  updateById(
    tx: Prisma.TransactionClient,
    id: string,
    data: Prisma.ConversationUpdateInput,
  ): Promise<Conversation> {
    return tx.conversation.update({ where: { id }, data });
  },

  // --- simple single-record update (no activity needed) ---

  async updateScoped(
    companyId: string,
    id: string,
    data: Prisma.ConversationUpdateManyMutationInput,
  ): Promise<Conversation | null> {
    const result = await prisma.conversation.updateMany({
      where: { id, companyId },
      data,
    });
    if (result.count === 0) return null;
    return this.findByIdScoped(companyId, id);
  },

  countByStatus(companyId: string): Promise<number> {
    return prisma.conversation.count({ where: { companyId } });
  },
};
