'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadStoredToken,
  storeToken,
  widgetClient,
  type WebChatConfig,
  type WidgetMessage,
} from './widget-client';

export type WebChatStatus = 'connecting' | 'ready' | 'error';

const POLL_INTERVAL_MS = 3000;

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/**
 * Drives a Web Chat conversation for a public widget key: connects (reconnecting
 * from a stored session token after refresh), sends messages, and polls for
 * agent/AI replies. `unread` counts replies received while `open` is false.
 */
export function useWebChat(publicId: string, open: boolean) {
  const [status, setStatus] = useState<WebChatStatus>('connecting');
  const [config, setConfig] = useState<WebChatConfig | null>(null);
  const [messages, setMessages] = useState<WidgetMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [assistantTyping, setAssistantTyping] = useState(false);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState('');

  const tokenRef = useRef<string | null>(null);
  const lastIdRef = useRef<string | undefined>(undefined);
  const openRef = useRef(open);
  openRef.current = open;

  const appendNew = useCallback((incoming: WidgetMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const fresh = incoming.filter((m) => !seen.has(m.id));
      if (fresh.length === 0) return prev;
      lastIdRef.current = fresh[fresh.length - 1].id;
      // Count inbound-from-support replies while the panel is closed.
      if (!openRef.current) {
        const replies = fresh.filter((m) => m.role !== 'visitor').length;
        if (replies > 0) setUnread((u) => u + replies);
      }
      return [...prev, ...fresh];
    });
  }, []);

  // Connect (or reconnect) on mount.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const stored = loadStoredToken(publicId);
        const session = await widgetClient.startSession(publicId, stored);
        if (!active) return;
        tokenRef.current = session.sessionToken;
        storeToken(publicId, session.sessionToken);
        setConfig(session.config);
        setMessages(session.messages);
        lastIdRef.current = session.messages.at(-1)?.id;
        setStatus('ready');
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to connect');
        setStatus('error');
      }
    })();
    return () => {
      active = false;
    };
  }, [publicId]);

  // Poll for new messages while connected.
  useEffect(() => {
    if (status !== 'ready') return;
    let active = true;
    const tick = async () => {
      if (!active || !tokenRef.current) return;
      try {
        const res = await widgetClient.poll(
          publicId,
          tokenRef.current,
          lastIdRef.current,
        );
        if (!active) return;
        appendNew(res.messages);
        if (res.messages.some((m) => m.role !== 'visitor')) {
          setAssistantTyping(false);
        }
      } catch {
        /* transient — next tick retries (reconnect handling) */
      }
    };
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    void tick();
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [status, publicId, appendNew]);

  // Clear unread when the panel opens.
  useEffect(() => {
    if (open) setUnread(0);
  }, [open]);

  const send = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || !tokenRef.current) return;
      setSending(true);
      try {
        const { message, autoReply } = await widgetClient.sendMessage(
          publicId,
          tokenRef.current,
          trimmed,
          uid(),
        );
        appendNew([message]);
        if (autoReply.generated) setAssistantTyping(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to send');
      } finally {
        setSending(false);
      }
    },
    [publicId, appendNew],
  );

  const notifyTyping = useCallback(() => {
    if (tokenRef.current) void widgetClient.typing(publicId, tokenRef.current);
  }, [publicId]);

  return {
    status,
    config,
    messages,
    sending,
    assistantTyping,
    unread,
    error,
    send,
    notifyTyping,
  };
}
