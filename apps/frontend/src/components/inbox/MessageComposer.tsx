'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui';

const MAX = 4000;

/**
 * Controlled composer. The parent owns the text so an AI draft can be inserted
 * and the employee can review/edit before sending. `toolbar` renders AI controls
 * above the textarea.
 */
export function MessageComposer({
  value,
  onChange,
  onSend,
  sending,
  disabled,
  toolbar,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending?: boolean;
  disabled?: boolean;
  toolbar?: ReactNode;
}) {
  const trimmed = value.trim();
  const canSend = !!trimmed && !sending && !disabled;

  return (
    <div className="border-t border-slate-200 p-3">
      {toolbar && <div className="mb-2">{toolbar}</div>}
      <textarea
        value={value}
        disabled={sending || disabled}
        onChange={(e) => onChange(e.target.value.slice(0, MAX))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (canSend) onSend();
          }
        }}
        placeholder="Type a reply…  (Enter to send, Shift+Enter for a new line)"
        aria-label="Message"
        rows={2}
        className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 disabled:bg-slate-100"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-slate-400">
          {value.length}/{MAX}
        </span>
        <Button onClick={onSend} loading={sending} disabled={!canSend}>
          Send
        </Button>
      </div>
    </div>
  );
}
