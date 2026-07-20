'use client';

import { useState } from 'react';
import { Spinner } from '@/components/ui';
import type { RegenerateAdjustment } from '@/lib/resources';

const ADJUSTMENTS: { key: RegenerateAdjustment; label: string }[] = [
  { key: 'shorter', label: 'Make it shorter' },
  { key: 'friendlier', label: 'Make it friendlier' },
  { key: 'more_formal', label: 'Make it more formal' },
  { key: 'arabic', label: 'Answer in Arabic' },
  { key: 'english', label: 'Answer in English' },
];

/**
 * All AI actions collapsed into one compact dropdown button. Replaces the old
 * always-visible AI toolbar so the composer/header stay uncluttered.
 */
export function AIAssistantMenu({
  generating,
  canDirectReply,
  hasDraft,
  onDraft,
  onRegenerate,
  onReply,
}: {
  generating: boolean;
  canDirectReply: boolean;
  hasDraft: boolean;
  onDraft: () => void;
  onRegenerate: (adjustment: RegenerateAdjustment) => void;
  onReply: () => void;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={generating}
        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-60"
      >
        {generating ? <Spinner size={13} /> : '✨'}
        AI Assistant
        <span className="text-xs">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={close} aria-hidden="true" />
          <div className="absolute right-0 z-30 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
            <button
              type="button"
              className="block w-full px-3 py-2 text-left hover:bg-slate-50"
              onClick={() => {
                close();
                onDraft();
              }}
            >
              ✨ Generate draft
            </button>

            <div className="my-1 border-t border-slate-100" />
            <p className="px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Regenerate
            </p>
            {ADJUSTMENTS.map((a) => (
              <button
                key={a.key}
                type="button"
                disabled={!hasDraft}
                className="block w-full px-3 py-1.5 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                onClick={() => {
                  close();
                  onRegenerate(a.key);
                }}
              >
                {a.label}
              </button>
            ))}

            {canDirectReply && (
              <>
                <div className="my-1 border-t border-slate-100" />
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left font-medium text-slate-800 hover:bg-slate-50"
                  onClick={() => {
                    close();
                    onReply();
                  }}
                >
                  Send AI reply directly
                </button>
              </>
            )}

            <p className="px-3 pb-1 pt-1 text-[11px] text-slate-400">
              AI can make mistakes — review before sending.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
