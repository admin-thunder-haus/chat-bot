'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useWebChat } from './useWebChat';
import type { WebChatConfig, WidgetMessage } from './widget-client';

type ThemeMode = 'light' | 'dark' | 'auto';

interface ChatWidgetProps {
  publicId: string;
  /** 'standalone' = floating launcher + panel; 'panel' = just the panel (iframe). */
  mode?: 'standalone' | 'panel';
  theme?: ThemeMode;
  /** Unsaved config overrides for the live dashboard preview. */
  configOverride?: Partial<WebChatConfig> | null;
  startOpen?: boolean;
}

/** Minimal localization table (config overrides labels; strings can be swapped). */
const STRINGS = {
  placeholder: 'Type your message…',
  send: 'Send',
  online: 'We typically reply quickly',
  typing: 'typing…',
  connecting: 'Connecting…',
  error: 'Connection problem. Retrying…',
};

function resolveDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function ChatWidget({
  publicId,
  mode = 'standalone',
  theme = 'auto',
  configOverride,
  startOpen,
}: ChatWidgetProps) {
  const isPanel = mode === 'panel';

  // The widget is a fully client-driven, theme-aware component (theme/'auto'
  // depends on matchMedia, which the server cannot know). Render nothing until
  // mounted so SSR and the first client render always agree — no hydration
  // mismatch for any theme. The connect state covers the brief gap.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // In panel mode, "open" is driven by the host loader (iframe visibility).
  const [visible, setVisible] = useState(isPanel ? true : Boolean(startOpen));
  const open = isPanel ? true : visible;

  const {
    status,
    config: fetchedConfig,
    messages,
    sending,
    assistantTyping,
    unread,
    send,
    notifyTyping,
  } = useWebChat(publicId, open);

  const config: WebChatConfig | null = useMemo(
    () => (fetchedConfig ? { ...fetchedConfig, ...configOverride } : null),
    [fetchedConfig, configOverride],
  );

  // Resolve dark mode AFTER mount to avoid an SSR/client hydration mismatch
  // ('auto' depends on matchMedia, which the server cannot know). First render
  // uses a deterministic value on both sides.
  const [dark, setDark] = useState(theme === 'dark');
  useEffect(() => {
    setDark(theme === 'auto' ? resolveDark('auto') : theme === 'dark');
    if (theme !== 'auto' || typeof window === 'undefined' || !window.matchMedia) {
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [theme]);

  const accent = config?.themeColor ?? '#0f172a';
  const c = palette(dark);

  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll to the newest message (and while the assistant is typing).
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, assistantTyping, open]);

  // Panel mode: report unread up to the host loader; accept visibility changes.
  useEffect(() => {
    if (!isPanel || typeof window === 'undefined') return;
    window.parent?.postMessage({ type: 'webchat:unread', count: unread }, '*');
  }, [isPanel, unread]);

  // Panel mode: tell the host loader the theme/position once config is loaded so
  // the (host-DOM) launcher can match the configured color + side.
  useEffect(() => {
    if (!isPanel || typeof window === 'undefined' || !config) return;
    window.parent?.postMessage(
      {
        type: 'webchat:ready',
        color: config.themeColor,
        position: config.position,
        launcherText: config.launcherText,
      },
      '*',
    );
  }, [isPanel, config]);

  useEffect(() => {
    if (!isPanel || typeof window === 'undefined') return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'webchat:visibility') setVisible(Boolean(e.data.open));
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [isPanel]);

  function submit() {
    if (!draft.trim() || sending) return;
    void send(draft);
    setDraft('');
  }

  function onDraftChange(v: string) {
    setDraft(v);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => notifyTyping(), 250);
  }

  // Until mounted, render a neutral placeholder (identical on server + first
  // client render) — guarantees no hydration mismatch for any theme.
  if (!mounted) {
    return isPanel ? (
      <div className="h-full w-full" style={{ background: '#ffffff' }} />
    ) : null;
  }

  const panel = (
    <div
      className="flex h-full w-full flex-col overflow-hidden"
      style={{ background: c.bg, color: c.text }}
      role="dialog"
      aria-label={config?.title ?? 'Chat'}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ background: accent, color: '#fff' }}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {config?.title ?? STRINGS.connecting}
          </p>
          <p className="truncate text-[11px] opacity-80">{STRINGS.online}</p>
        </div>
        {!isPanel && (
          <button
            type="button"
            aria-label="Close chat"
            onClick={() => setVisible(false)}
            className="rounded-md p-1 text-white/90 transition hover:bg-white/20"
          >
            ✕
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-2 overflow-y-auto px-3 py-3"
        aria-live="polite"
      >
        {config?.welcomeMessage && messages.length === 0 && status === 'ready' && (
          <Bubble
            message={{ id: 'welcome', role: 'assistant', content: config.welcomeMessage, createdAt: '' }}
            accent={accent}
            colors={c}
            assistantLabel={config.assistantLabel}
            agentLabel={config.agentLabel}
            showTime={false}
          />
        )}
        {messages.map((m) => (
          <Bubble
            key={m.id}
            message={m}
            accent={accent}
            colors={c}
            assistantLabel={config?.assistantLabel ?? 'Assistant'}
            agentLabel={config?.agentLabel ?? 'Support'}
          />
        ))}
        {assistantTyping && (
          <div className="flex items-center gap-1 px-1 text-xs" style={{ color: c.muted }}>
            <TypingDots color={c.muted} />
            <span>{config?.assistantLabel ?? 'Assistant'} {STRINGS.typing}</span>
          </div>
        )}
        {status === 'connecting' && (
          <p className="px-1 text-xs" style={{ color: c.muted }}>{STRINGS.connecting}</p>
        )}
        {status === 'error' && (
          <p className="px-1 text-xs text-red-500">{STRINGS.error}</p>
        )}
      </div>

      {/* Composer */}
      <div className="flex items-end gap-2 border-t px-3 py-2" style={{ borderColor: c.border }}>
        <textarea
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          aria-label="Message"
          placeholder={STRINGS.placeholder}
          disabled={status !== 'ready'}
          className="max-h-24 flex-1 resize-none rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: c.inputBg, color: c.text, border: `1px solid ${c.border}` }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={sending || !draft.trim() || status !== 'ready'}
          aria-label={STRINGS.send}
          className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-white transition disabled:opacity-50"
          style={{ background: accent }}
        >
          {STRINGS.send}
        </button>
      </div>
    </div>
  );

  if (isPanel) {
    return <div className="h-full w-full">{panel}</div>;
  }

  // Standalone: floating launcher + animated panel.
  const side = config?.position === 'left' ? { left: 20 } : { right: 20 };
  return (
    <div style={{ position: 'fixed', bottom: 20, zIndex: 2147483000, ...side }}>
      {open && (
        <div
          className="mb-3 overflow-hidden rounded-2xl shadow-2xl"
          style={{
            width: 'min(92vw, 380px)',
            height: 'min(70vh, 560px)',
            animation: 'wc-in 160ms ease-out',
          }}
        >
          {panel}
        </div>
      )}
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={open ? 'Close chat' : config?.launcherText ?? 'Chat'}
        aria-expanded={open}
        className="relative flex h-14 w-14 items-center justify-center rounded-full text-white shadow-xl transition active:scale-95"
        style={{ background: accent, marginLeft: config?.position === 'left' ? 0 : 'auto' }}
      >
        <span aria-hidden="true" className="text-2xl">{open ? '✕' : '💬'}</span>
        {!open && unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      <style>{`@keyframes wc-in{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

interface Colors {
  bg: string;
  text: string;
  muted: string;
  border: string;
  inputBg: string;
  agentBubble: string;
  agentText: string;
}

function palette(dark: boolean): Colors {
  return dark
    ? {
        bg: '#0b1220',
        text: '#e2e8f0',
        muted: '#94a3b8',
        border: '#1e293b',
        inputBg: '#0f172a',
        agentBubble: '#1e293b',
        agentText: '#e2e8f0',
      }
    : {
        bg: '#ffffff',
        text: '#0f172a',
        muted: '#64748b',
        border: '#e2e8f0',
        inputBg: '#ffffff',
        agentBubble: '#f1f5f9',
        agentText: '#0f172a',
      };
}

function Bubble({
  message,
  accent,
  colors,
  assistantLabel,
  agentLabel,
  showTime = true,
}: {
  message: WidgetMessage;
  accent: string;
  colors: Colors;
  assistantLabel: string;
  agentLabel: string;
  showTime?: boolean;
}) {
  const visitor = message.role === 'visitor';
  const label =
    message.role === 'assistant'
      ? assistantLabel
      : message.role === 'agent'
        ? agentLabel
        : null;
  const bubbleStyle: CSSProperties = visitor
    ? { background: accent, color: '#fff' }
    : { background: colors.agentBubble, color: colors.agentText };

  return (
    <div className={`flex ${visitor ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[82%]">
        {label && (
          <p className="mb-0.5 px-1 text-[10px] font-semibold" style={{ color: colors.muted }}>
            {label}
          </p>
        )}
        <div
          className="whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm"
          style={bubbleStyle}
        >
          {message.mediaUrl && (
            <a
              href={message.mediaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- provider-hosted media URLs cannot go through next/image */}
              <img
                src={message.mediaUrl}
                alt="Attached media"
                className={`max-h-64 rounded-lg object-cover ${message.content ? 'mb-2' : ''}`}
              />
            </a>
          )}
          {message.content}
        </div>
        {showTime && message.createdAt && (
          <p
            className={`mt-0.5 px-1 text-[10px] ${visitor ? 'text-right' : 'text-left'}`}
            style={{ color: colors.muted }}
          >
            {fmtTime(message.createdAt)}
          </p>
        )}
      </div>
    </div>
  );
}

function TypingDots({ color }: { color: string }) {
  return (
    <span className="inline-flex gap-0.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: color, animation: `wc-blink 1s ${i * 0.15}s infinite` }}
        />
      ))}
      <style>{`@keyframes wc-blink{0%,60%,100%{opacity:.3}30%{opacity:1}}`}</style>
    </span>
  );
}
