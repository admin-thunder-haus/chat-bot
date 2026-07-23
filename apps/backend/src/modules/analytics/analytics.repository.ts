import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';

/**
 * Read-only aggregation queries for AI analytics. Every query is scoped by
 * companyId; raw SQL is used only where Prisma's groupBy cannot express the
 * aggregation (per-day buckets, duration averages).
 */
export const analyticsRepository = {
  conversationCount(companyId: string, since: Date): Promise<number> {
    return prisma.conversation.count({
      where: { companyId, createdAt: { gte: since } },
    });
  },

  async conversationsByDay(
    companyId: string,
    since: Date,
  ): Promise<{ date: string; count: number }[]> {
    const rows = await prisma.$queryRaw<{ day: Date; count: number }[]>(
      Prisma.sql`
        SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::int AS count
        FROM conversations
        WHERE "companyId" = ${companyId}::uuid AND "createdAt" >= ${since}
        GROUP BY 1
        ORDER BY 1
      `,
    );
    return rows.map((r) => ({
      date: r.day.toISOString().slice(0, 10),
      count: r.count,
    }));
  },

  async conversationsByChannel(
    companyId: string,
    since: Date,
  ): Promise<{ channelType: string; count: number }[]> {
    const rows = await prisma.conversation.groupBy({
      by: ['channelType'],
      where: { companyId, createdAt: { gte: since } },
      _count: { _all: true },
    });
    return rows
      .map((r) => ({ channelType: r.channelType, count: r._count._all }))
      .sort((a, b) => b.count - a.count);
  },

  async conversationsByStatus(
    companyId: string,
    since: Date,
  ): Promise<{ status: string; count: number }[]> {
    const rows = await prisma.conversation.groupBy({
      by: ['status'],
      where: { companyId, createdAt: { gte: since } },
      _count: { _all: true },
    });
    return rows.map((r) => ({ status: r.status, count: r._count._all }));
  },

  resolvedCount(companyId: string, since: Date): Promise<number> {
    return prisma.conversation.count({
      where: { companyId, resolvedAt: { gte: since } },
    });
  },

  async avgResolutionHours(
    companyId: string,
    since: Date,
  ): Promise<number | null> {
    const rows = await prisma.$queryRaw<{ avg_hours: number | null }[]>(
      Prisma.sql`
        SELECT AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt")) / 3600) AS avg_hours
        FROM conversations
        WHERE "companyId" = ${companyId}::uuid
          AND "resolvedAt" IS NOT NULL
          AND "resolvedAt" >= ${since}
      `,
    );
    const value = rows[0]?.avg_hours;
    return value === null || value === undefined ? null : Number(value);
  },

  handoffCount(companyId: string, since: Date): Promise<number> {
    return prisma.conversation.count({
      where: { companyId, handoffRequestedAt: { gte: since } },
    });
  },

  async handoffByReason(
    companyId: string,
    since: Date,
  ): Promise<{ reason: string; count: number }[]> {
    const rows = await prisma.conversation.groupBy({
      by: ['handoffReason'],
      where: {
        companyId,
        handoffRequestedAt: { gte: since },
        handoffReason: { not: null },
      },
      _count: { _all: true },
    });
    return rows
      .map((r) => ({ reason: r.handoffReason ?? 'unknown', count: r._count._all }))
      .sort((a, b) => b.count - a.count);
  },

  async generationsByStatus(
    companyId: string,
    since: Date,
  ): Promise<{ status: string; count: number }[]> {
    const rows = await prisma.aIResponseGeneration.groupBy({
      by: ['status'],
      where: { companyId, createdAt: { gte: since } },
      _count: { _all: true },
    });
    return rows.map((r) => ({ status: r.status, count: r._count._all }));
  },

  async generationsByType(
    companyId: string,
    since: Date,
  ): Promise<{ type: string; count: number }[]> {
    const rows = await prisma.aIResponseGeneration.groupBy({
      by: ['generationType'],
      where: { companyId, createdAt: { gte: since } },
      _count: { _all: true },
    });
    return rows
      .map((r) => ({ type: r.generationType, count: r._count._all }))
      .sort((a, b) => b.count - a.count);
  },

  autoRepliesSent(companyId: string, since: Date): Promise<number> {
    return prisma.aIResponseGeneration.count({
      where: {
        companyId,
        createdAt: { gte: since },
        generationType: 'AUTO_REPLY',
        status: 'COMPLETED',
        generatedMessageId: { not: null },
      },
    });
  },

  /** Context summaries of recent reply generations (for entity tallies). */
  recentContextSummaries(
    companyId: string,
    since: Date,
    limit = 500,
  ): Promise<{ contextSummary: Prisma.JsonValue }[]> {
    return prisma.aIResponseGeneration.findMany({
      where: {
        companyId,
        createdAt: { gte: since },
        status: 'COMPLETED',
        generationType: { in: ['AUTO_REPLY', 'DRAFT', 'REGENERATE', 'SUGGESTION'] },
      },
      select: { contextSummary: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  async languages(
    companyId: string,
    since: Date,
  ): Promise<{ code: string; count: number }[]> {
    const rows = await prisma.conversation.groupBy({
      by: ['detectedLanguage'],
      where: {
        companyId,
        createdAt: { gte: since },
        detectedLanguage: { not: null },
      },
      _count: { _all: true },
    });
    return rows
      .map((r) => ({ code: r.detectedLanguage ?? 'unknown', count: r._count._all }))
      .sort((a, b) => b.count - a.count);
  },

  // Name resolvers for tallied ids — all tenant-scoped.
  faqNames(companyId: string, ids: string[]) {
    return prisma.frequentlyAskedQuestion.findMany({
      where: { companyId, id: { in: ids } },
      select: { id: true, question: true },
    });
  },
  serviceNames(companyId: string, ids: string[]) {
    return prisma.businessService.findMany({
      where: { companyId, id: { in: ids } },
      select: { id: true, name: true },
    });
  },
  productNames(companyId: string, ids: string[]) {
    return prisma.product.findMany({
      where: { companyId, id: { in: ids } },
      select: { id: true, name: true },
    });
  },
  documentNames(companyId: string, ids: string[]) {
    return prisma.knowledgeDocument.findMany({
      where: { companyId, id: { in: ids } },
      select: { id: true, fileName: true },
    });
  },
};
