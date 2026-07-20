import { z } from 'zod';
import { ReplyTone } from '@prisma/client';

const nullableText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(max).nullable().optional(),
  );

const languageCode = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(10)
  .optional();

/**
 * PUT /ai-settings — upsert. Partial fields are allowed; anything omitted keeps
 * its current (or default) value. `.strict()` rejects unknown fields.
 */
export const updateAISettingsSchema = z
  .object({
    assistantName: nullableText(80),
    systemInstructions: nullableText(4000),
    replyTone: z.nativeEnum(ReplyTone).optional(),
    preferredLanguage: languageCode,
    fallbackMessage: z.string().trim().min(1).max(500).optional(),
    humanHandoffMessage: z.string().trim().min(1).max(500).optional(),
    maxReplyLength: z
      .number()
      .int()
      .min(50, 'Maximum reply length must be at least 50')
      .max(4000, 'Maximum reply length must be at most 4000')
      .nullable()
      .optional(),
    useEmojis: z.boolean().optional(),
    autoReplyEnabled: z.boolean().optional(),
  })
  .strict();

export type UpdateAISettingsInput = z.infer<typeof updateAISettingsSchema>;
