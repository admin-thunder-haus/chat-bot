import { z } from 'zod';

// Safe hex color only — no arbitrary CSS values.
const hexColor = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/, 'Color must be a hex value like #33aaff')
    .nullable()
    .optional(),
);

export const createTagSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(50),
    color: hexColor,
  })
  .strict();

export const updateTagSchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    color: hexColor,
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
  });

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
