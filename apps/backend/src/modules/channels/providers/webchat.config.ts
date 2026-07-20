/**
 * Safe, non-sensitive Web Chat widget configuration. Stored under a channel
 * account's `metadata.webchat` and exposed publicly to the widget. Contains NO
 * secrets — only presentation + behavior knobs.
 */
export interface WebChatConfig {
  title: string;
  welcomeMessage: string;
  themeColor: string;
  position: 'left' | 'right';
  locale: string;
  launcherText: string;
  agentLabel: string;
  assistantLabel: string;
  /** Optional origin allowlist (informational in Part 3; CORS reflects origin). */
  allowedOrigins: string[];
}

export const DEFAULT_WEBCHAT_CONFIG: WebChatConfig = {
  title: 'Chat with us',
  welcomeMessage: 'Hi! 👋 How can we help you today?',
  themeColor: '#0f172a',
  position: 'right',
  locale: 'en',
  launcherText: 'Chat',
  agentLabel: 'Support',
  assistantLabel: 'Assistant',
  allowedOrigins: [],
};

/** Read a full, defaulted config from an account's metadata JSON. */
export function readWebChatConfig(metadata: unknown): WebChatConfig {
  const raw =
    metadata && typeof metadata === 'object' && 'webchat' in metadata
      ? ((metadata as { webchat?: unknown }).webchat as
          | Partial<WebChatConfig>
          | undefined)
      : undefined;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_WEBCHAT_CONFIG };
  return {
    title: str(raw.title, DEFAULT_WEBCHAT_CONFIG.title, 80),
    welcomeMessage: str(
      raw.welcomeMessage,
      DEFAULT_WEBCHAT_CONFIG.welcomeMessage,
      500,
    ),
    themeColor: hexColor(raw.themeColor, DEFAULT_WEBCHAT_CONFIG.themeColor),
    position: raw.position === 'left' ? 'left' : 'right',
    locale: str(raw.locale, DEFAULT_WEBCHAT_CONFIG.locale, 10),
    launcherText: str(
      raw.launcherText,
      DEFAULT_WEBCHAT_CONFIG.launcherText,
      40,
    ),
    agentLabel: str(raw.agentLabel, DEFAULT_WEBCHAT_CONFIG.agentLabel, 40),
    assistantLabel: str(
      raw.assistantLabel,
      DEFAULT_WEBCHAT_CONFIG.assistantLabel,
      40,
    ),
    allowedOrigins: Array.isArray(raw.allowedOrigins)
      ? raw.allowedOrigins
          .filter((o): o is string => typeof o === 'string')
          .slice(0, 20)
      : DEFAULT_WEBCHAT_CONFIG.allowedOrigins,
  };
}

function str(v: unknown, fallback: string, max: number): string {
  if (typeof v !== 'string') return fallback;
  const t = v.trim();
  return t === '' ? fallback : t.slice(0, max);
}

function hexColor(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}
