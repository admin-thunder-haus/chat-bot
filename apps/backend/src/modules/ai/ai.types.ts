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
  documentIds: string[];
  historyMessageCount: number;
  approxCharacters: number;
  injectionSuspected: boolean;
}

/** Parsed request from the model to perform a registered business action. */
export interface AIActionRequest {
  action: string;
  input: Record<string, unknown>;
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
  /** True when the model signalled it cannot answer from company info. */
  lowConfidence: boolean;
  /** Auto-detected language of the customer's message (ISO 639-1 or 'unknown'). */
  detectedLanguage: string;
  usedFallback: boolean;
  contextSummary: ContextSummary;
  /**
   * Image of the service/product the reply recommends (null when none).
   * Attached out-of-band on channels whose provider supports media.
   */
  attachment: RecommendedAttachment | null;
  /**
   * Parsed ACTION_REQUEST when the model asked to perform a registered action
   * (only possible when the run allowed actions). The raw sentinel text stays
   * in `text`; callers execute the action instead of sending it.
   */
  actionRequest: AIActionRequest | null;
}
