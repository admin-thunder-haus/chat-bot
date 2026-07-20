'use client';

import { Button } from '@/components/ui';
import type { ConversationDetail } from '@/lib/types';

/** Shown when a human handoff was requested or AI is not active. */
export function AIHandoffBanner({
  conversation,
  canResume,
  busy,
  onResume,
}: {
  conversation: ConversationDetail;
  canResume: boolean;
  busy: boolean;
  onResume: () => void;
}) {
  if (conversation.aiMode === 'ENABLED' && !conversation.handoffRequestedAt) {
    return null;
  }

  const handoff = Boolean(conversation.handoffRequestedAt);
  return (
    <div className="flex items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <span>
        {handoff
          ? 'A human handoff was requested — automatic AI replies are paused.'
          : `Automatic AI replies are ${conversation.aiMode === 'HUMAN_ONLY' ? 'off (human only)' : 'paused'}.`}
      </span>
      {canResume && conversation.aiMode !== 'ENABLED' && (
        <Button size="sm" variant="secondary" disabled={busy} onClick={onResume}>
          Resume AI
        </Button>
      )}
    </div>
  );
}
