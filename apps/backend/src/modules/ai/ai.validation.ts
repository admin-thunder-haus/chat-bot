import { z } from 'zod';
import { AIConversationMode, ReplyTone } from '@prisma/client';

export const draftSchema = z
  .object({
    instruction: z.string().trim().max(300).optional(),
  })
  .strict();

export const regenerateSchema = z
  .object({
    adjustment: z.enum([
      'shorter',
      'friendlier',
      'more_formal',
      'arabic',
      'english',
    ]),
  })
  .strict();

// Direct AI reply takes no client-controlled generation parameters.
export const replySchema = z.object({}).strict();

/** Agent-facing reply suggestions (1-3 alternatives, default 2). */
export const suggestionsSchema = z
  .object({
    count: z.number().int().min(1).max(3).default(2),
  })
  .strict();

/** On-demand conversation summary takes no parameters. */
export const summarySchema = z.object({}).strict();

export const aiModeSchema = z
  .object({ mode: z.nativeEnum(AIConversationMode) })
  .strict();

export const playgroundSchema = z
  .object({
    question: z.string().trim().min(1, 'A question is required').max(2000),
    tone: z.nativeEnum(ReplyTone).optional(),
    language: z.string().trim().toLowerCase().min(2).max(10).optional(),
    includeHistory: z.boolean().optional(),
  })
  .strict();

export const generationsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  conversationId: z.string().uuid().optional(),
});

export type DraftInput = z.infer<typeof draftSchema>;
export type SuggestionsInput = z.infer<typeof suggestionsSchema>;
export type RegenerateInput = z.infer<typeof regenerateSchema>;
export type PlaygroundInput = z.infer<typeof playgroundSchema>;
export type GenerationsListQuery = z.infer<typeof generationsListQuerySchema>;
