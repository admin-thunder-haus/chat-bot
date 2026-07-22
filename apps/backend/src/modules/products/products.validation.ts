import { z } from 'zod';
import {
  booleanQuery,
  categorySchema,
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

const skuField = z
  .string()
  .trim()
  .max(64, 'SKU must be at most 64 characters')
  .nullable()
  .optional();

const stockField = z
  .number({ invalid_type_error: 'Stock quantity must be a number' })
  .int('Stock quantity must be a whole number')
  .min(0, 'Stock quantity cannot be negative')
  .max(100_000_000)
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

export const createProductSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    description: z.string().trim().max(2000).nullable().optional(),
    sku: skuField,
    category: categorySchema.nullable(),
    price: priceField,
    currency: currencyField,
    stockQuantity: stockField,
    imageUrl: imageUrlField,
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    sku: skuField,
    category: categorySchema.nullable(),
    price: priceField,
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter code (e.g. JOD)')
      .optional(),
    stockQuantity: stockField,
    imageUrl: imageUrlField,
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
  });

export const productStatusSchema = z
  .object({ isActive: z.boolean() })
  .strict();

export const productListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: searchQuery,
  isActive: booleanQuery,
  category: z.string().trim().max(60).optional(),
  sortBy: z
    .enum(['sortOrder', 'name', 'price', 'createdAt', 'updatedAt'])
    .default('sortOrder'),
  sortOrder: sortOrderQuery.default('asc'),
});

// ---------------------------------------------------------------------------
// Excel import
// ---------------------------------------------------------------------------

/**
 * One Excel row. Keys are normalized headers (lowercase, no spaces), so the
 * template columns are: name, description, sku, category, price, currency,
 * stockQuantity, imageUrl, isActive, sortOrder.
 */
export const productImportRowSchema = z
  .object({
    name: z.preprocess(
      cellString,
      z
        .string({ required_error: 'Name is required' })
        .min(1, 'Name is required')
        .max(120),
    ),
    description: z.preprocess(cellString, z.string().max(2000).optional()),
    sku: z.preprocess(cellString, z.string().max(64).optional()),
    category: z.preprocess(cellString, z.string().max(60).optional()),
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
    stockquantity: z.preprocess(
      cellNumber,
      z
        .number({ invalid_type_error: 'Stock quantity must be a number' })
        .int('Stock quantity must be a whole number')
        .min(0, 'Stock quantity cannot be negative')
        .max(100_000_000)
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
    sku: r.sku ?? null,
    category: r.category ?? null,
    price: r.price ?? null,
    currency: r.currency ?? 'JOD',
    stockQuantity: r.stockquantity ?? null,
    imageUrl: r.imageurl ?? null,
    isActive: r.isactive ?? true,
    sortOrder: r.sortorder,
  }));

/** Multipart text field accompanying the import commit upload. */
export const importCommitSchema = z.object({
  // merge: upsert by name (default). replace: delete everything, then insert.
  mode: z.enum(['merge', 'replace']).default('merge'),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type ProductImportRow = z.infer<typeof productImportRowSchema>;
export type ImportCommitInput = z.infer<typeof importCommitSchema>;
