import { z } from 'zod';
import {
  booleanQuery,
  categorySchema,
  searchQuery,
  sortOrderQuery,
} from '../../validations/common.validation';

export {
  reorderSchema,
  type ReorderInput,
} from '../../validations/common.validation';

export const createFaqSchema = z
  .object({
    question: z.string().trim().min(1, 'Question is required').max(500),
    answer: z.string().trim().min(1, 'Answer is required').max(5000),
    category: categorySchema,
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

export const updateFaqSchema = z
  .object({
    question: z.string().trim().min(1).max(500).optional(),
    answer: z.string().trim().min(1).max(5000).optional(),
    category: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().trim().max(60).nullable().optional(),
    ),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
  });

export const faqStatusSchema = z.object({ isActive: z.boolean() }).strict();

export const faqListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: searchQuery,
  category: z.string().trim().max(60).optional(),
  isActive: booleanQuery,
  sortBy: z
    .enum(['sortOrder', 'question', 'createdAt', 'updatedAt'])
    .default('sortOrder'),
  sortOrder: sortOrderQuery.default('asc'),
});

export type CreateFaqInput = z.infer<typeof createFaqSchema>;
export type UpdateFaqInput = z.infer<typeof updateFaqSchema>;
export type FaqListQuery = z.infer<typeof faqListQuerySchema>;
