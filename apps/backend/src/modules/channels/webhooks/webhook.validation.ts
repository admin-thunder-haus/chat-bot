import { z } from 'zod';

/**
 * Webhook route params. Kept permissive on purpose: a strict 400 with details
 * would leak information about which ids/providers are valid. The service treats
 * unknown providers/accounts generically instead.
 */
export const webhookParamsSchema = z.object({
  providerKey: z.string().min(1).max(40),
  channelAccountId: z.string().min(1).max(100),
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when a string is a well-formed UUID (used to avoid DB errors on junk). */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export type WebhookParams = z.infer<typeof webhookParamsSchema>;
