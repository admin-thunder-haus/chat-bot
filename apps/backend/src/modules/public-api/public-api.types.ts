import type { ApiKey, OutboundWebhook, OutboundWebhookDelivery } from '@prisma/client';
import type { OutboundWebhookWithCount } from './public-api.repository';

export interface SerializedApiKey {
  id: string;
  name: string;
  /** Display prefix only — the full key is returned exactly once at creation. */
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export function serializeApiKey(key: ApiKey): SerializedApiKey {
  return {
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    scopes: key.scopes,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt,
    createdAt: key.createdAt,
  };
}

export interface SerializedWebhook {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  failureCount: number;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Total logged deliveries (present on list reads). */
  deliveryCount?: number;
}

export function serializeWebhook(
  webhook: OutboundWebhook | OutboundWebhookWithCount,
): SerializedWebhook {
  return {
    id: webhook.id,
    url: webhook.url,
    events: webhook.events,
    isActive: webhook.isActive,
    failureCount: webhook.failureCount,
    lastSuccessAt: webhook.lastSuccessAt,
    lastFailureAt: webhook.lastFailureAt,
    createdAt: webhook.createdAt,
    updatedAt: webhook.updatedAt,
    ...('_count' in webhook
      ? { deliveryCount: webhook._count.deliveries }
      : {}),
  };
}

export interface SerializedDelivery {
  id: string;
  eventType: string;
  status: string;
  attemptCount: number;
  responseStatus: number | null;
  errorMessage: string | null;
  createdAt: Date;
}

export function serializeDelivery(
  d: OutboundWebhookDelivery,
): SerializedDelivery {
  return {
    id: d.id,
    eventType: d.eventType,
    status: d.status,
    attemptCount: d.attemptCount,
    responseStatus: d.responseStatus,
    errorMessage: d.errorMessage,
    createdAt: d.createdAt,
  };
}
