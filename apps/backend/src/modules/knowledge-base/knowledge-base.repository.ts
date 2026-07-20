import type { KnowledgeBaseEntry, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { toSkipTake } from '../../utils/pagination';
import type { KnowledgeListFilters } from './knowledge-base.types';

/** Tenant-scoped data-access for knowledge-base entries. */
export const knowledgeBaseRepository = {
  create(
    companyId: string,
    data: Omit<Prisma.KnowledgeBaseEntryUncheckedCreateInput, 'companyId'>,
  ): Promise<KnowledgeBaseEntry> {
    return prisma.knowledgeBaseEntry.create({
      data: { ...data, companyId },
    });
  },

  findByIdScoped(
    companyId: string,
    id: string,
  ): Promise<KnowledgeBaseEntry | null> {
    return prisma.knowledgeBaseEntry.findFirst({ where: { id, companyId } });
  },

  async list(
    companyId: string,
    filters: KnowledgeListFilters,
  ): Promise<{ items: KnowledgeBaseEntry[]; total: number }> {
    const where: Prisma.KnowledgeBaseEntryWhereInput = { companyId };

    if (filters.isActive !== undefined) where.isActive = filters.isActive;
    if (filters.category) where.category = filters.category;
    if (filters.tag) where.tags = { has: filters.tag };
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { content: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const { skip, take } = toSkipTake(filters.page, filters.limit);
    const orderBy: Prisma.KnowledgeBaseEntryOrderByWithRelationInput[] = [
      { [filters.sortBy]: filters.sortOrder },
      { createdAt: 'asc' },
    ];

    const [items, total] = await prisma.$transaction([
      prisma.knowledgeBaseEntry.findMany({ where, orderBy, skip, take }),
      prisma.knowledgeBaseEntry.count({ where }),
    ]);

    return { items, total };
  },

  async update(
    companyId: string,
    id: string,
    data: Prisma.KnowledgeBaseEntryUpdateManyMutationInput,
  ): Promise<KnowledgeBaseEntry | null> {
    const result = await prisma.knowledgeBaseEntry.updateMany({
      where: { id, companyId },
      data,
    });
    if (result.count === 0) return null;
    return this.findByIdScoped(companyId, id);
  },

  async remove(companyId: string, id: string): Promise<number> {
    const result = await prisma.knowledgeBaseEntry.deleteMany({
      where: { id, companyId },
    });
    return result.count;
  },

  countByIds(companyId: string, ids: string[]): Promise<number> {
    return prisma.knowledgeBaseEntry.count({
      where: { companyId, id: { in: ids } },
    });
  },

  async reorder(
    companyId: string,
    items: { id: string; sortOrder: number }[],
  ): Promise<void> {
    await prisma.$transaction(
      items.map((item) =>
        prisma.knowledgeBaseEntry.updateMany({
          where: { id: item.id, companyId },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
  },

  listOrdered(companyId: string): Promise<KnowledgeBaseEntry[]> {
    return prisma.knowledgeBaseEntry.findMany({
      where: { companyId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  },

  countAll(companyId: string): Promise<number> {
    return prisma.knowledgeBaseEntry.count({ where: { companyId } });
  },
};
