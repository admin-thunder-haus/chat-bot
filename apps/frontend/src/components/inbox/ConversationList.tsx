'use client';

import { Alert, Button, EmptyState, Skeleton } from '@/components/ui';
import type { ConversationListItem as Conversation, Pagination } from '@/lib/types';
import { ConversationListItem } from './ConversationListItem';

export function ConversationList({
  items,
  loading,
  error,
  pagination,
  activeId,
  onSelect,
  onLoadMore,
}: {
  items: Conversation[];
  loading: boolean;
  error: string;
  pagination: Pagination | null;
  activeId: string | null;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
}) {
  const hasMore =
    pagination !== null && pagination.page < pagination.totalPages;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {error && (
        <div className="p-3">
          <Alert message={error} />
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="No conversations"
            description="Conversations will appear here as customers reach out."
          />
        </div>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
