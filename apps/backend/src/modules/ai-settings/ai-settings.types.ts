import { ReplyTone, type CompanyAISettings } from '@prisma/client';

/**
 * API view of AI settings. When no row exists yet, defaults are returned with
 * `id`/timestamps set to null so the frontend can render the form immediately.
 */
export interface AISettingsView {
  id: string | null;
  companyId: string;
  assistantName: string | null;
  systemInstructions: string | null;
  replyTone: ReplyTone;
  preferredLanguage: string;
  fallbackMessage: string;
  humanHandoffMessage: string;
  maxReplyLength: number | null;
  useEmojis: boolean;
  autoReplyEnabled: boolean;
  // --- Day 11: human handoff rules ---
  handoffOnRequest: boolean;
  handoffOnLowConfidence: boolean;
  handoffKeywords: string[];
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** Defaults mirror the Prisma schema defaults for CompanyAISettings. */
export function buildDefaultSettings(companyId: string): AISettingsView {
  return {
    id: null,
    companyId,
    assistantName: null,
    systemInstructions: null,
    replyTone: ReplyTone.PROFESSIONAL,
    preferredLanguage: 'auto',
    fallbackMessage:
      "Sorry, I couldn't understand that. Could you rephrase?",
    humanHandoffMessage: 'Let me connect you with a member of our team.',
    maxReplyLength: null,
    useEmojis: false,
    autoReplyEnabled: false,
    handoffOnRequest: true,
    handoffOnLowConfidence: true,
    handoffKeywords: [],
    createdAt: null,
    updatedAt: null,
  };
}

export function serializeSettings(row: CompanyAISettings): AISettingsView {
  return { ...row };
}
