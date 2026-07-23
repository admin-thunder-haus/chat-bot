import { request } from '../api';
import type { AISettings, ReplyTone } from '../types';

export interface AISettingsInput {
  assistantName?: string | null;
  systemInstructions?: string | null;
  replyTone?: ReplyTone;
  preferredLanguage?: string;
  fallbackMessage?: string;
  humanHandoffMessage?: string;
  maxReplyLength?: number | null;
  useEmojis?: boolean;
  autoReplyEnabled?: boolean;
  handoffOnRequest?: boolean;
  handoffOnLowConfidence?: boolean;
  handoffKeywords?: string[];
}

export const aiSettingsApi = {
  get(): Promise<{ settings: AISettings }> {
    return request('/ai-settings', { auth: true });
  },
  save(input: AISettingsInput): Promise<{ settings: AISettings }> {
    return request('/ai-settings', { method: 'PUT', body: input, auth: true });
  },
};
