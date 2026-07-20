'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Spinner } from '@/components/ui';
import type { Message } from '@/lib/types';
import { MessageBubble } from './MessageBubble';

/**
 * Scrollable message thread with correct chat behavior:
 * - Jumps to the newest message when a conversation opens.
 * - Preserves scroll position when older messages are prepended.
 * - Auto-scrolls on new messages only if the user is already near the bottom;
 *   otherwise shows a "New messages" button.
 * - A "Load older messages" control stays pinned at the top of the area.
 */
export function MessageThread({
  conversationId,
  messages,
  hasMore,
  loadingOlder,
  loading,
  onLoadOlder,
  composer,
}: {
  conversationId: string;
  messages: Message[];
  hasMore: boolean;
  loadingOlder: boolean;
  loading: boolean;
  onLoadOlder: () => void;
  composer: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showNew, setShowNew] = useState(false);

  const prevConv = useRef<string | null>(null);
  const firstIdRef = useRef<string | null>(null);
  const lastIdRef = useRef<string | null>(null);
  const nearBottomRef = useRef(true);
  const pendingOlderHeight = useRef<number | null>(null);

  function isNearBottom(): boolean {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  function handleScroll() {
    nearBottomRef.current = isNearBottom();
    if (nearBottomRef.current) setShowNew(false);
  }

  function scrollToBottom() {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setShowNew(false);
  }

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstId = messages[0]?.id ?? null;
    const lastId = messages[messages.length - 1]?.id ?? null;

    if (prevConv.current !== conversationId) {
      prevConv.current = conversationId;
      firstIdRef.current = firstId;
      lastIdRef.current = lastId;
      el.scrollTop = el.scrollHeight;
      nearBottomRef.current = true;
      setShowNew(false);
      return;
    }

    if (pendingOlderHeight.current !== null && firstId !== firstIdRef.current) {
      // Older messages prepended — keep the viewport anchored.
      el.scrollTop += el.scrollHeight - pendingOlderHeight.current;
      pendingOlderHeight.current = null;
    } else if (lastId !== lastIdRef.current) {
      if (nearBottomRef.current) el.scrollTop = el.scrollHeight;
      else setShowNew(true);
    }

    firstIdRef.current = firstId;
    lastIdRef.current = lastId;
  }, [messages, conversationId]);

  function loadOlder() {
    pendingOlderHeight.current = scrollRef.current?.scrollHeight ?? 0;
    onLoadOlder();
  }

  const hasMessages = messages.length > 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Pinned top bar: always-visible "Load older" control. */}
      {hasMessages && (
        <div className="shrink-0 border-b border-slate-100 bg-slate-50/60 px-4 py-1.5 text-center">
          {loadingOlder ? (
            <span className="inline-flex items-center gap-2 text-xs text-slate-400">
              <Spinner size={12} /> Loading older messages…
            </span>
          ) : hasMore ? (
            <button
              type="button"
              onClick={loadOlder}
              className="text-xs font-medium text-slate-600 underline-offset-2 hover:underline"
            >
              ↑ Load older messages
            </button>
          ) : (
            <span className="text-xs text-slate-400">Beginning of conversation</span>
          )}
        </div>
      )}

      {/* Scrollable message list. */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {loading && messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">Loading messages…</p>
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            No messages yet. Start the conversation below.
          </p>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
      </div>

      {showNew && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-28 left-1/2 -translate-x-1/2 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-md"
        >
          New messages ↓
        </button>
      )}

      {composer}
    </div>
  );
}
