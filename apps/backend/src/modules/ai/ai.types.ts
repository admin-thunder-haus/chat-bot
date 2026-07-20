import type { AIGenerationType } from '@prisma/client';

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
}
