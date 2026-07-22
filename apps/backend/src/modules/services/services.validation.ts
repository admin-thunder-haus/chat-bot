import { z } from 'zod';
import { ServicePriceType } from '@prisma/client';
import {
  booleanQuery,
  searchQuery,
  sortOrderQuery,
} from '../../validations/common.validation';
import {
  cellBoolean,
  cellNumber,
  cellString,
  urlCellSchema,
} from '../../utils/spreadsheet';

export { reorderSchema, type ReorderInput } from '../../validations/common.validation';

/** Price types that require a concrete price value. */
export const PRICED_TYPES: ServicePriceType[] = [
  ServicePriceType.FIXED,
  ServicePriceType.STARTING_FROM,
];

const priceField = z
  .number({ invalid_type_error: 'Price must be a number' })
  .nonnegative('Price must be non-negative')
  .max(99_999_999, 'Price is too large')
  .nullable()
  .optional();

const currencyField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter code (e.g. JOD)')
  .default('JOD');

const durationField = z
  .number({ invalid_type_error: 'Duration must be a number' })
  .int('Duration must be a whole number of minutes')
  .positive('Duration must be positive')
  .max(100_000)
  .nullable()
  .optional();

const imageUrlField = z
  .string()
  .trim()
  .max(2048, 'Image URL is too long')
  .url('Image URL must be a valid URL')
  .refine((u) => /^https?:\/\//i.test(u), {
    message: 'Image URL must start with http:// or https://',
  })
  .nullable()
  .optional();

export const createServiceSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    description: z.string().trim().max(1000).nullable().optional(),
    price: priceField,
    currency: currencyField,
    priceType: z.nativeEnum(ServicePriceType).default(ServicePriceType.FIXED),
    durationMinutes: durationField,
    imageUrl: imageUrlField,
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (
      PRICED_TYPES.includes(data.priceType) &&
      (data.price === undefined || data.price === null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['price'],
        message: `Price is required for price type ${data.priceType}`,
      });
    }
  });

export const updateServiceSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    price: priceField,
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter code (e.g. JOD)')
      .optional(),
    priceType: z.nativeEnum(ServicePriceType).optional(),
    durationMinutes: durationField,
    imageUrl: imageUrlField,
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
  });

export const serviceStatusSchema = z
  .object({ isActive: z.boolean() })
  .strict();

export const serviceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: searchQuery,
  isActive: booleanQuery,
  sortBy: z
    .enum(['sortOrder', 'name', 'price', 'createdAt', 'updatedAt'])
    .default('sortOrder'),
  sortOrder: sortOrderQuery.default('asc'),
});

// ---------------------------------------------------------------------------
// Excel import
// ---------------------------------------------------------------------------

/** Case/spacing-tolerant price type cell ("starting from" -> STARTING_FROM). */
const priceTypeCell = z.preprocess(
  (v) => {
    const s = cellString(v);
    return typeof s === 'string'
      ? s.toUpperCase().replace(/[\s-]+/g, '_')
      : s;
  },
  z
    .nativeEnum(ServicePriceType, {
      errorMap: () => ({
        message: `Price type must be one of: ${Object.values(ServicePriceType).join(', ')}`,
      }),
    })
    .optional(),
);

/**
 * One Excel row. Keys are normalized headers (lowercase, no spaces), so the
 * template columns are: name, description, price, currency, priceType,
 * durationMinutes, imageUrl, isActive, sortOrder.
 */
export const serviceImportRowSchema = z
  .object({
    name: z.preprocess(
      cellString,
      z
        .string({ required_error: 'Name is required' })
        .min(1, 'Name is required')
        .max(120),
    ),
    description: z.preprocess(cellString, z.string().max(1000).optional()),
    price: z.preprocess(
      cellNumber,
      z
        .number({ invalid_type_error: 'Price must be a number' })
        .nonnegative('Price must be non-negative')
        .max(99_999_999, 'Price is too large')
        .optional(),
    ),
    currency: z.preprocess(
      (v) => {
        const s = cellString(v);
        return typeof s === 'string' ? s.toUpperCase() : s;
      },
      z
        .string()
        .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter code (e.g. JOD)')
        .optional(),
    ),
    pricetype: priceTypeCell,
    durationminutes: z.preprocess(
      cellNumber,
      z
        .number({ invalid_type_error: 'Duration must be a number' })
        .int('Duration must be a whole number of minutes')
        .positive('Duration must be positive')
        .max(100_000)
        .optional(),
    ),
    imageurl: z.preprocess(cellString, urlCellSchema.optional()),
    isactive: z.preprocess(
      cellBoolean,
      z
        .boolean({ invalid_type_error: 'isActive must be true or false' })
        .optional(),
    ),
    sortorder: z.preprocess(
      cellNumber,
      z
        .number({ invalid_type_error: 'Sort order must be a number' })
        .int()
        .min(0)
        .max(1_000_000)
        .optional(),
    ),
  })
  .transform((r) => ({
    name: r.name,
    description: r.description ?? null,
    price: r.price ?? null,
    currency: r.currency ?? 'JOD',
    priceType: r.pricetype ?? ServicePriceType.FIXED,
    durationMinutes: r.durationminutes ?? null,
    imageUrl: r.imageurl ?? null,
    isActive: r.isactive ?? true,
    sortOrder: r.sortorder,
  }))
  .superRefine((data, ctx) => {
    if (PRICED_TYPES.includes(data.priceType) && data.price === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['price'],
        message: `Price is required for price type ${data.priceType}`,
      });
    }
  });

/** Multipart text field accompanying the import commit upload. */
export const importCommitSchema = z.object({
  // merge: upsert by name (default). replace: delete everything, then insert.
  mode: z.enum(['merge', 'replace']).default('merge'),
});

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
export type ServiceListQuery = z.infer<typeof serviceListQuerySchema>;
export type ServiceImportRow = z.infer<typeof serviceImportRowSchema>;
export type ImportCommitInput = z.infer<typeof importCommitSchema>;
