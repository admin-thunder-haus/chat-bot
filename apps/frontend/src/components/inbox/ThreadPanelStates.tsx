'use client';

import { Alert, Button, Skeleton } from '@/components/ui';

const SKELETON_BUBBLES: { outbound: boolean; width: string; height: string }[] = [
  { outbound: false, width: 'w-48', height: 'h-12' },
  { outbound: true, width: 'w-56', height: 'h-16' },
  { outbound: false, width: 'w-36', height: 'h-10' },
  { outbound: true, width: 'w-44', height: 'h-12' },
  { outbound: false, width: 'w-52', height: 'h-14' },
];

/** Loading placeholders shaped like real message bubbles (§4.1). */
export function MessageSkeletons() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {SKELETON_BUBBLES.map((b, i) => (
        <div key={i} className={`flex ${b.outbound ? 'justify-end' : 'justify-start'}`}>
          <Skeleton
            className={`${b.height} ${b.width} max-w-[85%] rounded-2xl sm:max-w-[75%]`}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Whole-pane loading state: header, bubbles and composer are all sketched so the
 * layout does not jump when the real conversation arrives.
 */
export function ThreadLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-slate-200 px-3 py-2.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-24" />
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-10 w-24 rounded-lg" />
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-4 py-4">
        <MessageSkeletons />
      </div>
      <div className="shrink-0 border-t border-slate-200 p-3">
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    </div>
  );
}

/** Whole-pane error state with a retry affordance (§4.2). */
export function ThreadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <Alert variant="error">
          <p>{message}</p>
          <div className="mt-3">
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          </div>
        </Alert>
      </div>
    </div>
  );
}

/**
 * Desktop-only placeholder for the message pane when nothing is selected. Below
 * `lg` the list occupies the screen instead, so this is never the only thing on
 * a phone.
 */
export function NoConversationSelected() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <span aria-hidden="true" className="text-3xl">
        💬
      </span>
      <p className="text-sm font-semibold text-slate-900">
        No conversation selected
      </p>
      <p className="max-w-xs text-sm text-slate-500">
        Pick a conversation from the list to read the thread, reply, and open
        customer details.
      </p>
    </div>
  );
}
