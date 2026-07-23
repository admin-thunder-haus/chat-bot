import { analyticsRepository } from './analytics.repository';
import type { AIAnalytics } from './analytics.types';

const TOP_LIMIT = 5;

/** Count id occurrences across generation context summaries. */
function tally(
  summaries: { contextSummary: unknown }[],
  key: 'faqIds' | 'serviceIds' | 'productIds' | 'documentIds',
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of summaries) {
    const summary = row.contextSummary as Record<string, unknown> | null;
    const ids = summary?.[key];
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      if (typeof id !== 'string') continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/** Top-N ids by count, resolved to labels via the provided lookup. */
async function topEntities<T extends { id: string }>(
  counts: Map<string, number>,
  resolve: (ids: string[]) => Promise<T[]>,
): Promise<(T & { count: number })[]> {
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_LIMIT);
  if (ranked.length === 0) return [];

  const rows = await resolve(ranked.map(([id]) => id));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ranked
    .map(([id, count]) => {
      const row = byId.get(id);
      // Entities deleted since generation are silently dropped.
      return row ? { ...row, count } : null;
    })
    .filter((r): r is T & { count: number } => r !== null);
}

export const analyticsService = {
  async getAIAnalytics(
    companyId: string,
    rangeDays: number,
  ): Promise<AIAnalytics> {
    const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);

    const [
      conversationTotal,
      byDay,
      byChannel,
      byStatus,
      resolvedInRange,
      avgResolutionHours,
      handoffTotal,
      handoffByReason,
      generationsByStatus,
      generationsByType,
      autoRepliesSent,
      contextSummaries,
      languages,
    ] = await Promise.all([
      analyticsRepository.conversationCount(companyId, since),
      analyticsRepository.conversationsByDay(companyId, since),
      analyticsRepository.conversationsByChannel(companyId, since),
      analyticsRepository.conversationsByStatus(companyId, since),
      analyticsRepository.resolvedCount(companyId, since),
      analyticsRepository.avgResolutionHours(companyId, since),
      analyticsRepository.handoffCount(companyId, since),
      analyticsRepository.handoffByReason(companyId, since),
      analyticsRepository.generationsByStatus(companyId, since),
      analyticsRepository.generationsByType(companyId, since),
      analyticsRepository.autoRepliesSent(companyId, since),
      analyticsRepository.recentContextSummaries(companyId, since),
      analyticsRepository.languages(companyId, since),
    ]);

    const completed =
      generationsByStatus.find((s) => s.status === 'COMPLETED')?.count ?? 0;
    const failed =
      generationsByStatus.find((s) => s.status === 'FAILED')?.count ?? 0;
    const generationTotal = generationsByStatus.reduce(
      (n, s) => n + s.count,
      0,
    );

    const [topFaqs, topServices, topProducts, topDocuments] =
      await Promise.all([
        topEntities(tally(contextSummaries, 'faqIds'), (ids) =>
          analyticsRepository.faqNames(companyId, ids),
        ),
        topEntities(tally(contextSummaries, 'serviceIds'), (ids) =>
          analyticsRepository.serviceNames(companyId, ids),
        ),
        topEntities(tally(contextSummaries, 'productIds'), (ids) =>
          analyticsRepository.productNames(companyId, ids),
        ),
        topEntities(tally(contextSummaries, 'documentIds'), (ids) =>
          analyticsRepository.documentNames(companyId, ids),
        ),
      ]);

    return {
      rangeDays,
      since,
      conversationVolume: {
        total: conversationTotal,
        byDay,
        byChannel,
      },
      resolution: {
        byStatus,
        resolvedInRange,
        avgResolutionHours:
          avgResolutionHours === null
            ? null
            : Math.round(avgResolutionHours * 10) / 10,
      },
      handoff: {
        total: handoffTotal,
        rate: conversationTotal > 0 ? handoffTotal / conversationTotal : 0,
        byReason: handoffByReason,
      },
      aiGenerations: {
        total: generationTotal,
        completed,
        failed,
        successRate:
          completed + failed > 0 ? completed / (completed + failed) : 0,
        byType: generationsByType,
        autoRepliesSent,
      },
      topFaqs,
      topServices,
      topProducts,
      topDocuments,
      languages,
    };
  },
};
