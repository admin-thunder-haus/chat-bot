'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui';

const MAX = 4000;
/** ~5 lines. Capped so a long draft can never push Send off a phone screen. */
const MAX_TEXTAREA_HEIGHT = 132;

/**
 * Controlled composer. The parent owns the text so an AI draft can be inserted
 * and the employee can review/edit before sending. `toolbar` renders AI controls
 * above the textarea and is free to wrap — it is never clipped.
 *
 * Mobile behaviour: full width, 40px tap targets, the textarea grows up to a cap
 * and then scrolls internally, and the bottom padding respects the iOS home
 * indicator via `env(safe-area-inset-bottom)`.
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow to fit the draft, capped, so Send stays on screen.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [value]);

  const trimmed = value.trim();
  const canSend = !!trimmed && !sending && !disabled;

  return (
    <div className="shrink-0 border-t border-slate-200 bg-white px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {toolbar && <div className="mb-2">{toolbar}</div>}

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          disabled={sending || disabled}
          onChange={(e) => onChange(e.target.value.slice(0, MAX))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          placeholder="Type a reply…"
          aria-label="Message"
          rows={1}
          className="min-h-10 min-w-0 flex-1 resize-none overflow-y-auto rounded-lg border border-slate-300 px-3 py-2 text-base outline-none transition focus-visible:border-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 disabled:bg-slate-100 sm:text-sm"
        />
        <Button
          onClick={onSend}
          loading={sending}
          disabled={!canSend}
          className="shrink-0"
        >
          Send
        </Button>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-slate-400">
        <span className="truncate">
          Enter to send · Shift+Enter for a new line
        </span>
        <span className="shrink-0 tabular-nums">
          {value.length}/{MAX}
        </span>
      </div>
    </div>
  );
}
