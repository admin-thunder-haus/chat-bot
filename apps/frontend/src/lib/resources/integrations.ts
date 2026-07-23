import { request } from '../api';
import type {
  ApiKey,
  ApiKeyCreated,
  DomainEventType,
  OutboundWebhook,
  OutboundWebhookCreated,
  WebhookDelivery,
} from '../types';

export interface CreateWebhookInput {
  url: string;
  events: DomainEventType[];
}

export interface UpdateWebhookInput {
  url?: string;
  events?: DomainEventType[];
  isActive?: boolean;
}

/** API keys + outbound webhooks management (OWNER / ADMIN). */
export const integrationsApi = {
  // --- API keys ---
  listApiKeys(): Promise<{ apiKeys: ApiKey[] }> {
    return request('/integrations/api-keys', { auth: true });
  },
  /** The returned `key` is shown once and can never be retrieved again. */
  createApiKey(name: string): Promise<ApiKeyCreated> {
    return request('/integrations/api-keys', {
      method: 'POST',
      body: { name },
      auth: true,
    });
  },
  revokeApiKey(id: string): Promise<{ apiKey: ApiKey }> {
    return request(`/integrations/api-keys/${id}`, {
      method: 'DELETE',
      auth: true,
    });
  },

  // --- Outbound webhooks ---
  listWebhooks(): Promise<{ webhooks: OutboundWebhook[] }> {
    return request('/integrations/webhooks', { auth: true });
  },
  /** The returned `secret` is shown once and can never be retrieved again. */
  createWebhook(input: CreateWebhookInput): Promise<OutboundWebhookCreated> {
    return request('/integrations/webhooks', {
      method: 'POST',
      body: input,
      auth: true,
    });
  },
  updateWebhook(
    id: string,
    input: UpdateWebhookInput,
  ): Promise<{ webhook: OutboundWebhook }> {
    return request(`/integrations/webhooks/${id}`, {
      method: 'PATCH',
      body: input,
      auth: true,
    });
  },
  deleteWebhook(id: string): Promise<null> {
    return request(`/integrations/webhooks/${id}`, {
      method: 'DELETE',
      auth: true,
    });
  },
  webhookDeliveries(id: string): Promise<{ deliveries: WebhookDelivery[] }> {
    return request(`/integrations/webhooks/${id}/deliveries`, { auth: true });
  },
};
