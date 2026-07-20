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

const tagsSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(20, 'At most 20 tags are allowed')
  .optional();

export const createKnowledgeSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(200),
    content: z.string().trim().min(1, 'Content is required').max(20000),
    category: categorySchema,
    tags: tagsSchema,
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

export const updateKnowledgeSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().trim().min(1).max(20000).optional(),
    category: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().trim().max(60).nullable().optional(),
    ),
    tags: tagsSchema,
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
  });

export const knowledgeStatusSchema = z
  .object({ isActive: z.boolean() })
  .strict();

export const knowledgeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: searchQuery,
  category: z.string().trim().max(60).optional(),
  tag: z.string().trim().max(40).optional(),
  isActive: booleanQuery,
  sortBy: z
    .enum(['sortOrder', 'title', 'createdAt', 'updatedAt'])
    .default('sortOrder'),
  sortOrder: sortOrderQuery.default('asc'),
});

export type CreateKnowledgeInput = z.infer<typeof createKnowledgeSchema>;
export type UpdateKnowledgeInput = z.infer<typeof updateKnowledgeSchema>;
export type KnowledgeListQuery = z.infer<typeof knowledgeListQuerySchema>;
