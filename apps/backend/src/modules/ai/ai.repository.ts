import type {
  AIResponseGeneration,
  AIUsageDaily,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../config/prisma';
import { toSkipTake } from '../../utils/pagination';

/** Midnight-UTC Date for aggregate day keys. */
export function utcDay(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export interface UsageDelta {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

/** Tenant-scoped data-access for AI generations + usage. */
export const aiRepository = {
  createGeneration(
    data: Prisma.AIResponseGenerationUncheckedCreateInput,
  ): Promise<AIResponseGeneration> {
    return prisma.aIResponseGeneration.create({ data });
  },

  async updateGeneration(
    companyId: string,
    id: string,
    data: Prisma.AIResponseGenerationUpdateManyMutationInput,
  ): Promise<AIResponseGeneration | null> {
    const result = await prisma.aIResponseGeneration.updateMany({
      where: { id, companyId },
      data,
    });
    if (result.count === 0) return null;
    return prisma.aIResponseGeneration.findFirst({ where: { id, companyId } });
  },

  findGenerationScoped(
    companyId: string,
    id: string,
  ): Promise<AIResponseGeneration | null> {
    return prisma.aIResponseGeneration.findFirst({ where: { id, companyId } });
  },

  async listGenerations(
    companyId: string,
    page: number,
    limit: number,
    conversationId?: string,
  ): Promise<{ items: AIResponseGeneration[]; total: number }> {
    const where: Prisma.AIResponseGenerationWhereInput = { companyId };
    if (conversationId) where.conversationId = conversationId;
    const { skip, take } = toSkipTake(page, limit);
    const [items, total] = await prisma.$transaction([
      prisma.aIResponseGeneration.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      prisma.aIResponseGeneration.count({ where }),
    ]);
    return { items, total };
  },

  /**
   * Recent conversation history for prompting — tenant-scoped, excludes failed
   * outbound messages, oldest-first. Internal notes are a separate table and
   * are never included.
   */
  async recentHistory(
    companyId: string,
    conversationId: string,
    limit: number,
  ): Promise<
    Pick<
      Prisma.MessageGetPayload<true>,
      'id' | 'direction' | 'senderType' | 'content' | 'createdAt'
    >[]
  > {
    const rows = await prisma.message.findMany({
      where: { companyId, conversationId, status: { not: 'FAILED' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        direction: true,
        senderType: true,
        content: true,
        createdAt: true,
      },
    });
    return rows.reverse();
  },

  // --- usage ---

  getDaily(companyId: string, date: Date): Promise<AIUsageDaily | null> {
    return prisma.aIUsageDaily.findUnique({
      where: { companyId_date: { companyId, date } },
    });
  },

  /** Atomically record one request's usage into the daily aggregate. */
  async recordUsage(
    companyId: string,
    date: Date,
    delta: UsageDelta,
  ): Promise<void> {
    await prisma.aIUsageDaily.upsert({
      where: { companyId_date: { companyId, date } },
      create: {
        companyId,
        date,
        requestCount: 1,
        inputTokenCount: delta.inputTokens,
        outputTokenCount: delta.outputTokens,
        totalTokenCount: delta.totalTokens,
        estimatedCostUsd: delta.estimatedCostUsd,
      },
      update: {
        requestCount: { increment: 1 },
        inputTokenCount: { increment: delta.inputTokens },
        outputTokenCount: { increment: delta.outputTokens },
        totalTokenCount: { increment: delta.totalTokens },
        estimatedCostUsd: { increment: delta.estimatedCostUsd },
      },
    });
  },

  /** Sum of total tokens for the calendar month containing `date`. */
  async monthlyTokenTotal(companyId: string, date: Date): Promise<number> {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
    const agg = await prisma.aIUsageDaily.aggregate({
      where: { companyId, date: { gte: start, lt: end } },
      _sum: { totalTokenCount: true },
    });
    return agg._sum.totalTokenCount ?? 0;
  },

  listUsage(
    companyId: string,
    fromDate: Date,
  ): Promise<AIUsageDaily[]> {
    return prisma.aIUsageDaily.findMany({
      where: { companyId, date: { gte: fromDate } },
      orderBy: { date: 'desc' },
    });
  },
};
