import type { ConversationTag, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';

/** Tenant-scoped data-access for conversation tags + assignments. */
export const conversationTagsRepository = {
  list(companyId: string): Promise<ConversationTag[]> {
    return prisma.conversationTag.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
    });
  },

  findByIdScoped(companyId: string, id: string): Promise<ConversationTag | null> {
    return prisma.conversationTag.findFirst({ where: { id, companyId } });
  },

  nameExists(
    companyId: string,
    name: string,
    excludeId?: string,
  ): Promise<boolean> {
    return prisma.conversationTag
      .findFirst({
        where: {
          companyId,
          name,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { id: true },
      })
      .then((r) => r !== null);
  },

  create(
    companyId: string,
    data: { name: string; color: string | null },
  ): Promise<ConversationTag> {
    return prisma.conversationTag.create({ data: { ...data, companyId } });
  },

  async update(
    companyId: string,
    id: string,
    data: Prisma.ConversationTagUpdateManyMutationInput,
  ): Promise<ConversationTag | null> {
    const result = await prisma.conversationTag.updateMany({
      where: { id, companyId },
      data,
    });
    if (result.count === 0) return null;
    return this.findByIdScoped(companyId, id);
  },

  /** Delete a tag and its assignments in one transaction. */
  async remove(companyId: string, id: string): Promise<number> {
    return prisma.$transaction(async (tx) => {
      const found = await tx.conversationTag.findFirst({
        where: { id, companyId },
        select: { id: true },
      });
      if (!found) return 0;
      await tx.conversationTagAssignment.deleteMany({
        where: { tagId: id, companyId },
      });
      await tx.conversationTag.delete({ where: { id } });
      return 1;
    });
  },

  listForConversation(
    companyId: string,
    conversationId: string,
  ): Promise<ConversationTag[]> {
    return prisma.conversationTag.findMany({
      where: { companyId, assignments: { some: { conversationId } } },
      orderBy: { name: 'asc' },
    });
  },
};
