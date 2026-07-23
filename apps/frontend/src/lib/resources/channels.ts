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

/** Providers connectable via the Meta OAuth / Embedded Signup flow. */
export type MetaOauthProvider = 'facebook' | 'instagram' | 'whatsapp';

/** Safe Meta OAuth status — config ids are public, secrets never leave the API. */
export interface MetaOauthStatus {
  configured: boolean;
  appId: string | null;
  whatsappConfigId: string | null;
  loginConfigId: string | null;
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
  /** Meta OAuth availability (one-click connect). */
  oauthStatus(): Promise<MetaOauthStatus> {
    return request('/channels/oauth/meta/status', { auth: true });
  },
  /** Begin the Meta OAuth redirect flow; navigate the browser to `url`. */
  oauthStart(provider: MetaOauthProvider): Promise<{ url: string }> {
    return request('/channels/oauth/meta/start', {
      method: 'POST',
      body: { provider },
      auth: true,
    });
  },
  /** Complete the WhatsApp Embedded Signup popup variant (JS-SDK postMessage). */
  oauthCompleteWhatsApp(input: {
    code: string;
    phoneNumberId?: string;
    wabaId?: string;
  }): Promise<{ account: ChannelAccount }> {
    return request('/channels/oauth/meta/whatsapp/complete', {
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
