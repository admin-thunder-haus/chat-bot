import { z } from 'zod';

/**
 * Reusable validation building blocks shared across modules.
 * Provides ready-made structures for route params and query strings so future
 * modules validate consistently.
 */

/** Param schema for routes that take a UUID `:id`. */
export const idParamSchema = z.object({
  id: z.string().uuid('A valid id is required'),
});

/** Generic pagination query structure for future list endpoints. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Password policy: min 8 chars, upper, lower, and a number. */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[0-9]/, 'Password must contain a number');

/** Normalized email: trimmed + lowercased. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('A valid email address is required')
  .max(254);

/** Param schema for a named UUID route param (e.g. `:serviceId`). */
export function uuidParam(field: string) {
  return z.object({
    [field]: z.string().uuid(`A valid ${field} is required`),
  });
}

/**
 * Coerce a query-string boolean ("true"/"false"/"1"/"0") into a real boolean.
 * Left optional so absence means "no filter".
 */
export const booleanQuery = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .optional();

/** Sort direction with a stable default. */
export const sortOrderQuery = z.enum(['asc', 'desc']).default('desc');

/** Free-text search input with a safe maximum length. */
export const searchQuery = z.string().trim().max(200).optional();

/** Base pagination fields shared by every Day 2 list endpoint. */
export const listQueryBase = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: searchQuery,
  sortOrder: sortOrderQuery,
});

/** Validated "HH:mm" 24-hour time string. */
export const hhmmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be in HH:mm 24-hour format');

/** Optional, trimmed string with a maximum length (empty string -> undefined). */
export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .optional();
}

/** Category label: optional, trimmed, short. */
export const categorySchema = optionalText(60);

/**
 * Shared batch-reorder body. Each item carries a UUID id + new sortOrder.
 * IDs are validated against the authenticated company in the service layer.
 */
export const reorderSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            sortOrder: z.number().int().min(0).max(1_000_000),
          })
          .strict(),
      )
      .min(1, 'At least one item is required')
      .max(500, 'Too many items'),
  })
  .strict();

export type ReorderInput = z.infer<typeof reorderSchema>;
