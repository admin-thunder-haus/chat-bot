import { z } from 'zod';
import { ChannelType } from '@prisma/client';

/** Provider keys are short, lower-case, url-safe identifiers. */
export const providerKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9_-]*$/, 'Invalid provider key');

const externalIdSchema = z.string().trim().min(1).max(191);

const displayNameSchema = z.string().trim().min(1).max(120);

/**
 * Safe metadata: a flat record of primitives only. No nested objects/arrays
 * (which could smuggle large blobs or credential-shaped data). Size is further
 * capped in the service.
 */
const metadataSchema = z.record(
  z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]),
);

export const createChannelAccountSchema = z
  .object({
    providerKey: providerKeySchema,
    displayName: displayNameSchema,
    externalAccountId: externalIdSchema.optional(),
    externalPageId: externalIdSchema.optional(),
    isDefault: z.boolean().optional(),
    metadata: metadataSchema.optional(),
  })
  .strict();

export const updateChannelAccountSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    isDefault: z.boolean().optional(),
    metadata: metadataSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field is required',
  });

/**
 * Status update: enable/disable and/or a safe status transition. Only a curated
 * subset of the status enum is client-settable (never DRAFT / ERROR, which are
 * internal states). Raw internal enum values outside this set are rejected.
 */
export const channelStatusSchema = z
  .object({
    isEnabled: z.boolean().optional(),
    status: z.enum(['CONNECTED', 'DISCONNECTED', 'SUSPENDED']).optional(),
  })
  .strict()
  .refine((v) => v.isEnabled !== undefined || v.status !== undefined, {
    message: 'Provide isEnabled and/or status',
  });

export const channelListQuerySchema = z
  .object({
    channelType: z.nativeEnum(ChannelType).optional(),
    providerKey: providerKeySchema.optional(),
    enabled: z.enum(['true', 'false']).optional(),
  })
  .strip();

/** Params for the manual delivery-retry endpoint (both UUIDs). */
export const deliveryRetryParamsSchema = z.object({
  channelAccountId: z.string().uuid('A valid channelAccountId is required'),
  deliveryId: z.string().uuid('A valid deliveryId is required'),
});

/**
 * Safe Web Chat widget configuration. Only presentation/behavior knobs — never
 * secrets. All fields optional (partial update). Rejects unknown fields.
 */
export const webChatConfigSchema = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    welcomeMessage: z.string().trim().min(1).max(500).optional(),
    themeColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a #RRGGBB hex color')
      .optional(),
    position: z.enum(['left', 'right']).optional(),
    locale: z.string().trim().min(2).max(10).optional(),
    launcherText: z.string().trim().min(1).max(40).optional(),
    agentLabel: z.string().trim().min(1).max(40).optional(),
    assistantLabel: z.string().trim().min(1).max(40).optional(),
    allowedOrigins: z
      .array(z.string().trim().url().max(200))
      .max(20)
      .optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field is required',
  });

export type WebChatConfigInput = z.infer<typeof webChatConfigSchema>;

/**
 * WhatsApp connect request. Collects Meta Cloud API identifiers + secrets. The
 * secrets (accessToken, appSecret, verifyToken) are encrypted server-side and
 * never returned. Provider-specific validation (required combinations) also runs
 * in the provider's prepareConnection hook. `.strict()` rejects unknown fields.
 */
export const whatsAppConnectSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    phoneNumberId: z.string().trim().min(1).max(64),
    wabaId: z.string().trim().min(1).max(64),
    displayPhoneNumber: z.string().trim().min(1).max(40).optional(),
    businessName: z.string().trim().min(1).max(120).optional(),
    accessToken: z.string().trim().min(20).max(1000),
    appSecret: z.string().trim().min(16).max(256),
    verifyToken: z.string().trim().min(6).max(256),
  })
  .strict();

export type WhatsAppConnectInput = z.infer<typeof whatsAppConnectSchema>;

/**
 * Instagram connect request. Collects the Meta Instagram Messaging identifiers +
 * secrets. The secrets (accessToken, appSecret, verifyToken) are encrypted
 * server-side and never returned. Routing uses the stable Instagram account id —
 * never the @username. `.strict()` rejects unknown fields (incl. companyId).
 */
export const instagramConnectSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    instagramAccountId: z.string().trim().min(1).max(64),
    instagramUsername: z.string().trim().min(1).max(80).optional(),
    facebookPageId: z.string().trim().min(1).max(64).optional(),
    businessName: z.string().trim().min(1).max(120).optional(),
    accessToken: z.string().trim().min(20).max(1000),
    appSecret: z.string().trim().min(16).max(256),
    verifyToken: z.string().trim().min(6).max(256),
  })
  .strict();

export type InstagramConnectInput = z.infer<typeof instagramConnectSchema>;

export type CreateChannelAccountInput = z.infer<
  typeof createChannelAccountSchema
>;
export type UpdateChannelAccountInput = z.infer<
  typeof updateChannelAccountSchema
>;
export type ChannelStatusInput = z.infer<typeof channelStatusSchema>;
export type ChannelListQuery = z.infer<typeof channelListQuerySchema>;
