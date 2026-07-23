import { z } from 'zod';
import { DOMAIN_EVENT_TYPES } from '../events/domain-events.types';

/** Scopes an API key may carry. Only reads exist on the public surface today. */
export const API_KEY_SCOPES = ['read'] as const;

export const createApiKeySchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(80),
    scopes: z
      .array(z.enum(API_KEY_SCOPES))
      .min(1, 'At least one scope is required')
      .max(API_KEY_SCOPES.length)
      .default(['read']),
  })
  .strict();

const eventTypeSchema = z.enum(DOMAIN_EVENT_TYPES);

const webhookUrlSchema = z
  .string()
  .trim()
  .max(2048, 'URL is too long')
  .url('A valid URL is required')
  .refine((u) => /^https?:\/\//i.test(u), {
    message: 'URL must start with http:// or https://',
  });

export const createWebhookSchema = z
  .object({
    url: webhookUrlSchema,
    events: z
      .array(eventTypeSchema)
      .min(1, 'Subscribe to at least one event')
      .max(DOMAIN_EVENT_TYPES.length),
  })
  .strict();

export const updateWebhookSchema = z
  .object({
    url: webhookUrlSchema.optional(),
    events: z
      .array(eventTypeSchema)
      .min(1, 'Subscribe to at least one event')
      .max(DOMAIN_EVENT_TYPES.length)
      .optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
  });

/** Query for the public read endpoints (server-to-server pagination). */
export const publicListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;
export type PublicListQuery = z.infer<typeof publicListQuerySchema>;
