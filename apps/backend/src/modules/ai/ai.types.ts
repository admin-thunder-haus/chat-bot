import type { AIGenerationType } from '@prisma/client';
import type { RecommendedAttachment } from './ai-context.service';

/** A recent conversation turn used to build history for the provider. */
export interface HistoryTurn {
  role: 'user' | 'assistant';
  senderLabel: 'Customer' | 'Agent' | 'AI';
  content: string;
}

/** Safe, non-sensitive record of which sources fed a generation. */
export interface ContextSummary {
  companyProfile: boolean;
  businessHoursIncluded: boolean;
  serviceIds: string[];
  productIds: string[];
  faqIds: string[];
  knowledgeIds: string[];
  historyMessageCount: number;
  approxCharacters: number;
  injectionSuspected: boolean;
}

/** Result returned to callers/clients — never includes hidden prompts/secrets. */
export interface AIGenerationResult {
  generationId: string;
  generationType: AIGenerationType;
  text: string;
  model: string;
  provider: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  latencyMs: number;
  handoffRequested: boolean;
  usedFallback: boolean;
  contextSummary: ContextSummary;
  /**
   * Image of the service/product the reply recommends (null when none).
   * Attached out-of-band on channels whose provider supports media.
   */
  attachment: RecommendedAttachment | null;
}
