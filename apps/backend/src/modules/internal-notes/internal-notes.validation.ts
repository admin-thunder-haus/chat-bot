import { z } from 'zod';

export const MAX_NOTE_LENGTH = 4000;

export const createNoteSchema = z
  .object({
    content: z
      .string()
      .trim()
      .min(1, 'Note content is required')
      .max(MAX_NOTE_LENGTH, `Note must be at most ${MAX_NOTE_LENGTH} characters`),
  })
  .strict();

export const updateNoteSchema = createNoteSchema;

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
