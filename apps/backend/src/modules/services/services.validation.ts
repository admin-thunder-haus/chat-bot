import { z } from 'zod';
import { ServicePriceType } from '@prisma/client';
import {
  booleanQuery,
  searchQuery,
  sortOrderQuery,
} from '../../validations/common.validation';

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

export const createServiceSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    description: z.string().trim().max(1000).nullable().optional(),
    price: priceField,
    currency: currencyField,
    priceType: z.nativeEnum(ServicePriceType).default(ServicePriceType.FIXED),
    durationMinutes: durationField,
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

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
export type ServiceListQuery = z.infer<typeof serviceListQuerySchema>;
