'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { notificationsApi } from '@/lib/resources';
import { relativeTime } from '@/lib/format';
import type { AppNotification, NotificationType } from '@/lib/types';
import { Button, Spinner } from '@/components/ui';

const POLL_INTERVAL_MS = 30_000;
const DROPDOWN_LIMIT = 10;

const TYPE_ICONS: Record<NotificationType, string> = {
  NEW_CONVERSATION: '💬',
  HANDOFF_REQUESTED: '🙋',
  AI_REPLY_FAILED: '⚠️',
  SUBSCRIPTION_EVENT: '💳',
  SYSTEM_ALERT: '🔔',
};

/**
 * Header bell: unread badge (polled every 30s), dropdown with the latest 10
 * notifications, per-row mark-read and mark-all-read.
 */
export function NotificationsBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const refreshUnread = useCallback(async () => {
    try {
      const { count } = await notificationsApi.unreadCount();
      setUnread(count);
    } catch {
      // Silent: the badge is best-effort (e.g. mid-refresh token rotation).
    }
  }, []);

  useEffect(() => {
    void refreshUnread();
    const timer = setInterval(() => void refreshUnread(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refreshUnread]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setLoading(true);
    try {
      const result = await notificationsApi.list({
        page: 1,
        limit: DROPDOWN_LIMIT,
      });
      setItems(result.items);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function markRead(notification: AppNotification) {
    if (notification.readAt) return;
    try {
      const { notification: updated } =
        await notificationsApi.markRead(notification.id);
      setItems((prev) =>
        prev.map((n) => (n.id === updated.id ? updated : n)),
      );
      setUnread((n) => Math.max(0, n - 1));
    } catch {
      // Leave the row as-is; the next poll corrects the badge.
    }
  }

  async function markAllRead() {
    try {
      await notificationsApi.markAllRead();
      const now = new Date().toISOString();
      setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? now })));
      setUnread(0);
    } catch {
      // Silent — next poll corrects the badge.
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => void toggleOpen()}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100"
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-[18px] text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-900">
              Notifications
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void markAllRead()}
              disabled={unread === 0}
            >
              Mark all read
            </Button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                No notifications yet
              </p>
            ) : (
              <ul>
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => void markRead(n)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${
                        n.readAt ? 'opacity-60' : ''
                      }`}
                    >
                      <span aria-hidden="true" className="mt-0.5">
                        {TYPE_ICONS[n.type] ?? '🔔'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium text-slate-900">
                            {n.title}
                          </span>
                          <span className="shrink-0 text-xs text-slate-400">
                            {relativeTime(n.createdAt)}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {n.body}
                        </span>
                      </span>
                      {!n.readAt && (
                        <span
                          aria-hidden="true"
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500"
                        />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
