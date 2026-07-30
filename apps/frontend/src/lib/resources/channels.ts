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
/**
 * A pending asset selection. Carries ids and display names only — the Page /
 * business access tokens stay on the backend and never reach this client.
 */
export interface MetaOauthSelectionPage {
  pageId: string;
  pageName: string | null;
  instagramAccountId: string | null;
}

export interface MetaOauthSelectionWaba {
  wabaId: string;
  wabaName: string | null;
  phones: {
    phoneNumberId: string;
    displayPhoneNumber: string | null;
    verifiedName: string | null;
  }[];
}

export interface MetaOauthSelection {
  id: string;
  provider: MetaOauthProvider;
  expiresAt: string;
  pages: MetaOauthSelectionPage[];
  wabas: MetaOauthSelectionWaba[];
}

export interface MetaOauthStatus {
  configured: boolean;
  appId: string | null;
  whatsappConfigId: string | null;
  loginConfigId: string | null;
}

/**
 * Instagram Login availability. Separate from {@link MetaOauthStatus} because
 * it reports a separate app identity: the Instagram App ID, which one-click
 * Instagram needs and which the Facebook app id says nothing about.
 */
export interface InstagramLoginStatus {
  configured: boolean;
  appId: string | null;
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
  /** Instagram Login availability (one-click Instagram connect). */
  instagramLoginStatus(): Promise<InstagramLoginStatus> {
    return request('/channels/oauth/instagram-login/status', { auth: true });
  },
  /**
   * Begin the one-click redirect flow; navigate the browser to `url`.
   *
   * Instagram goes to its own endpoint. It is a genuinely different OAuth flow
   * (Instagram Login, against instagram.com, with the Instagram app identity),
   * and it is the only Instagram model that can receive DM webhooks — the
   * Facebook-Login variant reachable via /meta/start cannot, whatever
   * permissions it is granted.
   */
  oauthStart(provider: MetaOauthProvider): Promise<{ url: string }> {
    if (provider === 'instagram') {
      return request('/channels/oauth/instagram-login/start', {
        method: 'POST',
        auth: true,
      });
    }
    return request('/channels/oauth/meta/start', {
      method: 'POST',
      body: { provider },
      auth: true,
    });
  },
  /**
   * Complete the WhatsApp Embedded Signup popup variant (JS-SDK postMessage).
   * Returns `{ account }` when the grant was unambiguous, or
   * `{ requiresSelection, selection }` when the operator still has to choose.
   */
  oauthCompleteWhatsApp(input: {
    code: string;
    phoneNumberId?: string;
    wabaId?: string;
  }): Promise<
    | { account: ChannelAccount }
    | { requiresSelection: true; selection: MetaOauthSelection }
  > {
    return request('/channels/oauth/meta/whatsapp/complete', {
      method: 'POST',
      body: input,
      auth: true,
    });
  },
  /** Read a pending asset selection (scoped to the caller's company). */
  oauthSelection(selectionId: string): Promise<{
    selection: MetaOauthSelection;
  }> {
    return request(
      `/channels/oauth/meta/selection/${encodeURIComponent(selectionId)}`,
      { auth: true },
    );
  },
  /** Connect exactly the asset the operator picked. */
  oauthConnectSelection(
    selectionId: string,
    choice: { pageId?: string; wabaId?: string; phoneNumberId?: string },
  ): Promise<{ account: ChannelAccount }> {
    return request(
      `/channels/oauth/meta/selection/${encodeURIComponent(selectionId)}/connect`,
      { method: 'POST', body: choice, auth: true },
    );
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
