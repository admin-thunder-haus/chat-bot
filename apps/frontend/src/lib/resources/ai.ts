import { request } from '../api';
import { toQuery } from './query';
import type {
  AIConversationMode,
  AIGenerationResult,
  AIUsageSummary,
  ConversationDetail,
  Message,
  Paginated,
  ReplyTone,
} from '../types';

export type RegenerateAdjustment =
  | 'shorter'
  | 'friendlier'
  | 'more_formal'
  | 'arabic'
  | 'english';

export interface AIGenerationRecord {
  id: string;
  conversationId: string | null;
  generationType: string;
  status: string;
  provider: string;
  model: string;
  inputTokenCount: number | null;
  outputTokenCount: number | null;
  totalTokenCount: number | null;
  estimatedCostUsd: string | null;
  latencyMs: number | null;
  responseText: string | null;
  failureCode: string | null;
  createdAt: string;
}

export const aiApi = {
  draft(
    conversationId: string,
    instruction?: string,
  ): Promise<AIGenerationResult> {
    return request(`/conversations/${conversationId}/ai/draft`, {
      method: 'POST',
      body: instruction ? { instruction } : {},
      auth: true,
    });
  },
  regenerate(
    conversationId: string,
    adjustment: RegenerateAdjustment,
  ): Promise<AIGenerationResult> {
    return request(`/conversations/${conversationId}/ai/regenerate`, {
      method: 'POST',
      body: { adjustment },
      auth: true,
    });
  },
  reply(
    conversationId: string,
  ): Promise<{ result: AIGenerationResult; message: Message }> {
    return request(`/conversations/${conversationId}/ai/reply`, {
      method: 'POST',
      body: {},
      auth: true,
    });
  },
  setMode(
    conversationId: string,
    mode: AIConversationMode,
  ): Promise<{ conversation: ConversationDetail }> {
    return request(`/conversations/${conversationId}/ai-mode`, {
      method: 'PATCH',
      body: { mode },
      auth: true,
    });
  },
  usage(): Promise<AIUsageSummary> {
    return request('/ai/usage', { auth: true });
  },
  generations(
    params: { page?: number; limit?: number; conversationId?: string } = {},
  ): Promise<Paginated<AIGenerationRecord>> {
    return request(`/ai/generations${toQuery(params)}`, { auth: true });
  },
  playground(input: {
    question: string;
    tone?: ReplyTone;
    language?: string;
    includeHistory?: boolean;
  }): Promise<AIGenerationResult> {
    return request('/ai/playground', { method: 'POST', body: input, auth: true });
  },
};
