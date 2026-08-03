'use client';

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Spinner } from '@/components/ui';
import type { Message } from '@/lib/types';
import { MessageBubble } from './MessageBubble';
import { MessageSkeletons } from './ThreadPanelStates';

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Today" / "Yesterday" / weekday / full date — never a raw ISO string. */
function dayLabel(iso: string): string {
  const date = new Date(iso);
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

type ThreadRow =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: string; message: Message };

/** Interleaves a date separator whenever the calendar day changes. */
function buildRows(messages: Message[]): ThreadRow[] {
  const rows: ThreadRow[] = [];
  let currentDay = '';
  for (const message of messages) {
    const stamp = message.sentAt ?? message.createdAt;
    const day = new Date(stamp).toDateString();
    if (day !== currentDay) {
      currentDay = day;
      rows.push({ kind: 'day', key: `day-${day}`, label: dayLabel(stamp) });
    }
    rows.push({ kind: 'message', key: message.id, message });
  }
  return rows;
}

function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span aria-hidden="true" className="h-px flex-1 bg-slate-200" />
      <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

/**
 * Scrollable message thread with correct chat behavior:
 * - Jumps to the newest message when a conversation opens.
 * - Preserves scroll position when older messages are prepended.
 * - Auto-scrolls on new messages only if the user is already near the bottom;
 *   otherwise shows a "New messages" button.
 * - A "Load older messages" control stays pinned at the top of the area.
 * - Date separators mark each new calendar day.
 */
export function MessageThread({
  conversationId,
  messages,
  hasMore,
  loadingOlder,
  loading,
  error,
  onLoadOlder,
  onRetry,
  composer,
}: {
  conversationId: string;
  messages: Message[];
  hasMore: boolean;
  loadingOlder: boolean;
  loading: boolean;
  /** Message-load failure; shown inline with a retry (§4.2). */
  error?: string;
  onLoadOlder: () => void;
  onRetry: () => void;
  composer: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showNew, setShowNew] = useState(false);

  const prevConv = useRef<string | null>(null);
  const firstIdRef = useRef<string | null>(null);
  const lastIdRef = useRef<string | null>(null);
  const nearBottomRef = useRef(true);
  const pendingOlderHeight = useRef<number | null>(null);

  const rows = useMemo(() => buildRows(messages), [messages]);

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
              className="rounded text-xs font-medium text-slate-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
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
        role="log"
        aria-label="Conversation messages"
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-4 sm:px-4"
      >
        {loading && !hasMessages ? (
          <MessageSkeletons />
        ) : error && !hasMessages ? (
          <Alert variant="error">
            <p>{error}</p>
            <div className="mt-3">
              <Button variant="secondary" onClick={onRetry}>
                Try again
              </Button>
            </div>
          </Alert>
        ) : !hasMessages ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
            <p className="text-sm font-medium text-slate-800">No messages yet</p>
            <p className="max-w-xs text-sm text-slate-500">
              Write the first reply below — it is delivered on the customer&apos;s
              own channel.
            </p>
          </div>
        ) : (
          rows.map((row) =>
            row.kind === 'day' ? (
              <DaySeparator key={row.key} label={row.label} />
            ) : (
              <MessageBubble key={row.key} message={row.message} />
            ),
          )
        )}
      </div>

      {showNew && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-32 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-2 text-xs font-medium text-white shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          New messages ↓
        </button>
      )}

      {composer}
    </div>
  );
}
