import { request } from '../api';
import type {
  ChannelAccount,
  ChannelAccountStatus,
  ChannelDiagnostics,
  ChannelProviderDescriptor,
  DeliveryRetryResult,
  FacebookConnectInput,
  InstagramConnectInput,
  TelegramConnectInput,
  WebChatConfig,
  WhatsAppConnectInput,
} from '../types';

export interface CreateChannelInput {
  providerKey: string;
  displayName: string;
  externalAccountId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface UpdateChannelInput {
  displayName?: string;
  isDefault?: boolean;
  metadata?: Record<string, string | number | boolean | null>;
}

export const channelsApi = {
  providers(): Promise<{ providers: ChannelProviderDescriptor[] }> {
    return request('/channels/providers', { auth: true });
  },
  list(): Promise<{ accounts: ChannelAccount[] }> {
    return request('/channels', { auth: true });
  },
  get(id: string): Promise<{ account: ChannelAccount }> {
    return request(`/channels/${id}`, { auth: true });
  },
  create(input: CreateChannelInput): Promise<{ account: ChannelAccount }> {
    return request('/channels', { method: 'POST', body: input, auth: true });
  },
  connectWhatsApp(
    input: WhatsAppConnectInput,
  ): Promise<{ account: ChannelAccount }> {
    return request('/channels/whatsapp/connect', {
      method: 'POST',
      body: input,
      auth: true,
    });
  },
  connectInstagram(
    input: InstagramConnectInput,
  ): Promise<{ account: ChannelAccount }> {
    return request('/channels/instagram/connect', {
      method: 'POST',
      body: input,
      auth: true,
    });
  },
  connectFacebook(
    input: FacebookConnectInput,
  ): Promise<{ account: ChannelAccount }> {
    return request('/channels/facebook/connect', {
      method: 'POST',
      body: input,
      auth: true,
    });
  },
  connectTelegram(
    input: TelegramConnectInput,
  ): Promise<{ account: ChannelAccount; webhookRegistered: boolean }> {
    return request('/channels/telegram/connect', {
      method: 'POST',
      body: input,
      auth: true,
    });
  },
  update(
    id: string,
    input: UpdateChannelInput,
  ): Promise<{ account: ChannelAccount }> {
    return request(`/channels/${id}`, {
      method: 'PATCH',
      body: input,
      auth: true,
    });
  },
  setStatus(
    id: string,
    input: { isEnabled?: boolean; status?: ChannelAccountStatus },
  ): Promise<{ account: ChannelAccount }> {
    return request(`/channels/${id}/status`, {
      method: 'PATCH',
      body: input,
      auth: true,
    });
  },
  disconnect(id: string): Promise<{ account: ChannelAccount }> {
    return request(`/channels/${id}`, { method: 'DELETE', auth: true });
  },
  deletePermanently(id: string): Promise<null> {
    return request(`/channels/${id}/permanent`, { method: 'DELETE', auth: true });
  },
  healthCheck(id: string): Promise<{ account: ChannelAccount }> {
    return request(`/channels/${id}/health-check`, {
      method: 'POST',
      auth: true,
    });
  },
  diagnostics(id: string): Promise<ChannelDiagnostics> {
    return request(`/channels/${id}/diagnostics`, { auth: true });
  },
  retryDelivery(
    channelAccountId: string,
    deliveryId: string,
  ): Promise<{ result: DeliveryRetryResult }> {
    return request(
      `/channels/${channelAccountId}/deliveries/${deliveryId}/retry`,
      { method: 'POST', auth: true },
    );
  },
  getWidgetConfig(
    id: string,
  ): Promise<{ publicId: string | null; config: WebChatConfig }> {
    return request(`/channels/${id}/widget-config`, { auth: true });
  },
  updateWidgetConfig(
    id: string,
    config: Partial<WebChatConfig>,
  ): Promise<{ publicId: string | null; config: WebChatConfig }> {
    return request(`/channels/${id}/widget-config`, {
      method: 'PATCH',
      body: config,
      auth: true,
    });
  },
};
