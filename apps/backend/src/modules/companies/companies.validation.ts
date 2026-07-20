import { z } from 'zod';

/**
 * Turn an empty/whitespace string into null so optional profile fields can be
 * cleared, while leaving real values intact.
 */
const emptyToNull = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? null : v;

/** Optional, nullable, trimmed text with a max length. */
const nullableText = (max: number) =>
  z.preprocess(
    emptyToNull,
    z.string().trim().max(max, `Must be at most ${max} characters`).nullable().optional(),
  );

/** Optional, nullable email. */
const nullableEmail = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .toLowerCase()
    .email('A valid email address is required')
    .max(254)
    .nullable()
    .optional(),
);

/** Optional, nullable URL. */
const nullableUrl = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .url('A valid URL is required (including http:// or https://)')
    .max(255)
    .nullable()
    .optional(),
);

/** Optional, nullable phone-like string (digits, spaces, +, -, parentheses). */
const nullablePhone = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .min(5, 'Phone number is too short')
    .max(30, 'Phone number is too long')
    .regex(/^[+()\-\s\d]+$/, 'Phone number contains invalid characters')
    .nullable()
    .optional(),
);

/** Language code such as `ar`, `en`, or `auto`. */
const languageCode = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Invalid language code')
  .max(10, 'Invalid language code');

/**
 * PATCH /company/profile — partial update. `.strict()` rejects unknown or
 * protected fields (id, slug, status, companyId, timestamps) with a 400.
 */
export const updateProfileSchema = z
  .object({
    // `name` may be changed; slug is intentionally preserved server-side.
    name: z.string().trim().min(2).max(100).optional(),
    displayName: nullableText(100),
    description: nullableText(2000),
    industry: nullableText(80),
    email: nullableEmail,
    phone: nullablePhone,
    whatsappNumber: nullablePhone,
    websiteUrl: nullableUrl,
    address: nullableText(255),
    city: nullableText(100),
    country: nullableText(100),
    timezone: z.string().trim().min(2).max(60).optional(),
    defaultLanguage: languageCode.optional(),
    responseLanguage: languageCode.optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
