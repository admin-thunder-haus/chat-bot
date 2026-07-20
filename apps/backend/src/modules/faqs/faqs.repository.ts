import type { FrequentlyAskedQuestion, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { toSkipTake } from '../../utils/pagination';
import type { FaqListFilters } from './faqs.types';

/** Tenant-scoped data-access for FAQs. */
export const faqsRepository = {
  create(
    companyId: string,
    data: Omit<Prisma.FrequentlyAskedQuestionUncheckedCreateInput, 'companyId'>,
  ): Promise<FrequentlyAskedQuestion> {
    return prisma.frequentlyAskedQuestion.create({
      data: { ...data, companyId },
    });
  },

  findByIdScoped(
    companyId: string,
    id: string,
  ): Promise<FrequentlyAskedQuestion | null> {
    return prisma.frequentlyAskedQuestion.findFirst({
      where: { id, companyId },
    });
  },

  async list(
    companyId: string,
    filters: FaqListFilters,
  ): Promise<{ items: FrequentlyAskedQuestion[]; total: number }> {
    const where: Prisma.FrequentlyAskedQuestionWhereInput = { companyId };

    if (filters.isActive !== undefined) where.isActive = filters.isActive;
    if (filters.category) where.category = filters.category;
    if (filters.search) {
      where.OR = [
        { question: { contains: filters.search, mode: 'insensitive' } },
        { answer: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const { skip, take } = toSkipTake(filters.page, filters.limit);
    const orderBy: Prisma.FrequentlyAskedQuestionOrderByWithRelationInput[] = [
      { [filters.sortBy]: filters.sortOrder },
      { createdAt: 'asc' },
    ];

    const [items, total] = await prisma.$transaction([
      prisma.frequentlyAskedQuestion.findMany({ where, orderBy, skip, take }),
      prisma.frequentlyAskedQuestion.count({ where }),
    ]);

    return { items, total };
  },

  async update(
    companyId: string,
    id: string,
    data: Prisma.FrequentlyAskedQuestionUpdateManyMutationInput,
  ): Promise<FrequentlyAskedQuestion | null> {
    const result = await prisma.frequentlyAskedQuestion.updateMany({
      where: { id, companyId },
      data,
    });
    if (result.count === 0) return null;
    return this.findByIdScoped(companyId, id);
  },

  async remove(companyId: string, id: string): Promise<number> {
    const result = await prisma.frequentlyAskedQuestion.deleteMany({
      where: { id, companyId },
    });
    return result.count;
  },

  countByIds(companyId: string, ids: string[]): Promise<number> {
    return prisma.frequentlyAskedQuestion.count({
      where: { companyId, id: { in: ids } },
    });
  },

  async reorder(
    companyId: string,
    items: { id: string; sortOrder: number }[],
  ): Promise<void> {
    await prisma.$transaction(
      items.map((item) =>
        prisma.frequentlyAskedQuestion.updateMany({
          where: { id: item.id, companyId },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
  },

  listOrdered(companyId: string): Promise<FrequentlyAskedQuestion[]> {
    return prisma.frequentlyAskedQuestion.findMany({
      where: { companyId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  },

  countAll(companyId: string): Promise<number> {
    return prisma.frequentlyAskedQuestion.count({ where: { companyId } });
  },
};
