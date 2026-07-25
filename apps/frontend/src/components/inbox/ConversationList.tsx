'use client';

import { Alert, Button, EmptyState, Skeleton } from '@/components/ui';
import type { ConversationListItem as Conversation, Pagination } from '@/lib/types';
import { ConversationListItem } from './ConversationListItem';

/** Loading placeholder shaped like a real row (§4.1) — same height, no jump. */
function RowSkeleton() {
  return (
    <div className="border-b border-slate-100 px-3 py-3">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 flex-1" />
        <Skeleton className="h-3 w-8" />
      </div>
      <Skeleton className="mt-2 h-3 w-24" />
      <Skeleton className="mt-2 h-3 w-full" />
      <div className="mt-2 flex gap-1">
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
    </div>
  );
}

export function ConversationList({
  items,
  loading,
  error,
  pagination,
  activeId,
  filtered,
  onSelect,
  onLoadMore,
  onRetry,
}: {
  items: Conversation[];
  loading: boolean;
  error: string;
  pagination: Pagination | null;
  activeId: string | null;
  /** True when a search term or any filter is active — changes the empty copy. */
  filtered: boolean;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  const hasMore =
    pagination !== null && pagination.page < pagination.totalPages;

  // 1. Loading — only when there is nothing to show yet; a refresh keeps the
  //    current rows in place so the pane never flashes.
  if (loading && items.length === 0 && !error) {
    return (
      <div className="h-full overflow-y-auto">
        {Array.from({ length: 6 }).map((_, i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    );
  }

  // 2. Error.
  if (error && items.length === 0) {
    return (
      <div className="h-full overflow-y-auto p-3">
        <Alert variant="error">
          <p>{error}</p>
          <div className="mt-3">
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          </div>
        </Alert>
      </div>
    );
  }

  // 3. Empty.
  if (items.length === 0) {
    return (
      <div className="h-full overflow-y-auto p-3">
        <EmptyState
          title={filtered ? 'No matching conversations' : 'No conversations yet'}
          description={
            filtered
              ? 'Nothing matches this search and filter combination. Clear them to see the whole inbox.'
              : 'Messages from your connected channels — WhatsApp, Instagram, Facebook, Telegram, web chat and email — land here automatically.'
          }
        />
      </div>
    );
  }

  // 4. Loaded.
  return (
    <div className="flex h-full flex-col overflow-y-auto overscroll-contain">
      {error && (
        <div className="p-3">
          <Alert variant="error" message={error} />
        </div>
      )}

      {items.map((c) => (
        <ConversationListItem
          key={c.id}
          conversation={c}
          active={c.id === activeId}
          onClick={() => onSelect(c.id)}
        />
      ))}

      {hasMore && (
        <div className="p-3">
          <Button
            variant="secondary"
            fullWidth
            loading={loading}
            onClick={onLoadMore}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
