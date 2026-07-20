import { z } from 'zod';
import { ChannelType } from '@prisma/client';
import {
  booleanQuery,
  searchQuery,
  sortOrderQuery,
} from '../../validations/common.validation';

const emptyToNull = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? null : v;

const nullableText = (max: number) =>
  z.preprocess(
    emptyToNull,
    z.string().trim().max(max).nullable().optional(),
  );

const nullableEmail = z.preprocess(
  emptyToNull,
  z.string().trim().toLowerCase().email().max(254).nullable().optional(),
);

const nullablePhone = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .min(5)
    .max(30)
    .regex(/^[+()\-\s\d]+$/, 'Phone number contains invalid characters')
    .nullable()
    .optional(),
);

const nullableUrl = z.preprocess(
  emptyToNull,
  z.string().trim().url().max(500).nullable().optional(),
);

// Bounded free-form metadata (records only; size checked in the service).
const metadataSchema = z.record(z.unknown()).optional();

export const createCustomerSchema = z
  .object({
    channelType: z.nativeEnum(ChannelType).default(ChannelType.MANUAL),
    externalId: nullableText(191),
    fullName: nullableText(120),
    firstName: nullableText(80),
    lastName: nullableText(80),
    phone: nullablePhone,
    email: nullableEmail,
    username: nullableText(120),
    avatarUrl: nullableUrl,
    notes: nullableText(2000),
    metadata: metadataSchema,
  })
  .strict()
  .refine(
    (d) => Boolean(d.fullName || d.firstName || d.phone || d.email || d.username),
    { message: 'At least one of fullName, phone, email, or username is required' },
  );

export const updateCustomerSchema = z
  .object({
    fullName: nullableText(120),
    firstName: nullableText(80),
    lastName: nullableText(80),
    phone: nullablePhone,
    email: nullableEmail,
    username: nullableText(120),
    avatarUrl: nullableUrl,
    notes: nullableText(2000),
    metadata: metadataSchema,
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
  });

export const customerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: searchQuery,
  channelType: z.nativeEnum(ChannelType).optional(),
  archived: booleanQuery, // reserved; customers have no archive flag yet
  sortBy: z
    .enum(['createdAt', 'lastSeenAt', 'firstSeenAt', 'fullName'])
    .default('lastSeenAt'),
  sortOrder: sortOrderQuery,
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;
