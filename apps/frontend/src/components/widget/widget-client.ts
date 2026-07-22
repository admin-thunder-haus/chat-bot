/**
 * Public Web Chat widget API client. Standalone (does NOT use the authenticated
 * dashboard api client): the widget runs on visitor browsers with no login. It
 * authenticates with the public widget key + a signed session token persisted in
 * localStorage, so a page refresh transparently reconnects the same visitor.
 */

const BASE_URL =
  (process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ||
    'http://localhost:4000') + '/api/v1/widget';

export interface WebChatConfig {
  title: string;
  welcomeMessage: string;
  themeColor: string;
  position: 'left' | 'right';
  locale: string;
  launcherText: string;
  agentLabel: string;
  assistantLabel: string;
  allowedOrigins: string[];
}

export type WidgetMessageRole = 'visitor' | 'agent' | 'assistant' | 'system';

export interface WidgetMessage {
  id: string;
  role: WidgetMessageRole;
  content: string;
  mediaUrl?: string | null;
  createdAt: string;
}

export interface WidgetSessionData {
  sessionToken: string;
  visitorId: string;
  conversationId: string | null;
  config: WebChatConfig;
  messages: WidgetMessage[];
}

const tokenKey = (publicId: string) => `webchat:${publicId}:session`;

export function loadStoredToken(publicId: string): string | null {
  try {
    return localStorage.getItem(tokenKey(publicId));
  } catch {
    return null;
  }
}

export function storeToken(publicId: string, token: string): void {
  try {
    localStorage.setItem(tokenKey(publicId), token);
  } catch {
    /* storage may be unavailable (private mode) — degrade gracefully */
  }
}

async function req<T>(
  publicId: string,
  path: string,
  opts: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers['X-Widget-Session'] = opts.token;
  const res = await fetch(`${BASE_URL}/${publicId}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;
  if (!res.ok || !payload?.success) {
    throw new Error(payload?.message || `Widget request failed (${res.status})`);
  }
  return payload.data as T;
}

export const widgetClient = {
  getConfig(publicId: string) {
    return req<{ publicId: string; channelType: string; config: WebChatConfig }>(
      publicId,
      '/config',
    );
  },
  startSession(publicId: string, token: string | null) {
    return req<WidgetSessionData>(publicId, '/session', {
      method: 'POST',
      body: token ? { sessionToken: token } : {},
    });
  },
  sendMessage(
    publicId: string,
    token: string,
    content: string,
    clientMessageId: string,
  ) {
    return req<{
      message: WidgetMessage;
      autoReply: { generated: boolean; reason?: string };
    }>(publicId, '/messages', {
      method: 'POST',
      token,
      body: { content, clientMessageId },
    });
  },
  poll(publicId: string, token: string, after?: string) {
    return req<{ messages: WidgetMessage[]; conversationId: string | null }>(
      publicId,
      `/messages${after ? `?after=${after}` : ''}`,
      { token },
    );
  },
  typing(publicId: string, token: string) {
    return req<{ ok: boolean }>(publicId, '/typing', {
      method: 'POST',
      token,
      body: { isTyping: true },
    }).catch(() => undefined);
  },
};
