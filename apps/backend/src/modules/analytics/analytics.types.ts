/**
 * AI analytics payload. Deliberately one cohesive response: the dashboard
 * renders everything from a single request, and new sections can be added
 * without new endpoints.
 */
export interface AIAnalytics {
  rangeDays: number;
  since: Date;

  conversationVolume: {
    total: number;
    byDay: { date: string; count: number }[];
    byChannel: { channelType: string; count: number }[];
  };

  resolution: {
    byStatus: { status: string; count: number }[];
    resolvedInRange: number;
    avgResolutionHours: number | null;
  };

  handoff: {
    total: number;
    /** Share of conversations in range that were handed off (0..1). */
    rate: number;
    byReason: { reason: string; count: number }[];
  };

  aiGenerations: {
    total: number;
    completed: number;
    failed: number;
    /** completed / (completed + failed), 0..1. */
    successRate: number;
    byType: { type: string; count: number }[];
    autoRepliesSent: number;
  };

  /** Entities most often surfaced to the AI while answering (proxy for
   *  "most asked about"), tallied from generation context summaries. */
  topFaqs: { id: string; question: string; count: number }[];
  topServices: { id: string; name: string; count: number }[];
  topProducts: { id: string; name: string; count: number }[];
  topDocuments: { id: string; fileName: string; count: number }[];

  /** Detected customer languages across conversations in range. */
  languages: { code: string; count: number }[];
}
