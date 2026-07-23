'use client';

import { useState } from 'react';
import { Button, ConfirmDialog, Spinner } from '@/components/ui';

/**
 * Dismissible list of AI reply suggestions shown above the composer.
 * "Use" fills the composer (with a confirm gate when the agent already has
 * text there, so a draft in progress is never silently overwritten);
 * "Send" delivers the suggestion immediately via the normal send path.
 */
export function SuggestionPanel({
  suggestions,
  loading,
  composerHasText,
  busy,
  onUse,
  onSend,
  onDismiss,
}: {
  suggestions: string[] | null;
  loading: boolean;
  /** True when the composer holds non-empty text the agent could lose. */
  composerHasText: boolean;
  /** Disables actions while a suggestion is being sent. */
  busy: boolean;
  onUse: (text: string) => void;
  onSend: (text: string) => void;
  onDismiss: () => void;
}) {
  const [pendingUse, setPendingUse] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
        <Spinner size={13} /> Generating suggestions…
      </div>
    );
  }

  if (!suggestions || suggestions.length === 0) return null;

  function handleUse(text: string) {
    if (composerHasText) setPendingUse(text);
    else onUse(text);
  }

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-2">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="text-xs font-semibold text-indigo-700">
          ✨ AI suggestions
        </span>
        <button
          type="button"
          aria-label="Dismiss suggestions"
          onClick={onDismiss}
          className="rounded p-0.5 text-indigo-400 hover:bg-indigo-100 hover:text-indigo-600"
        >
          ✕
        </button>
      </div>
      <ul className="space-y-1.5">
        {suggestions.map((s, i) => (
          <li
            key={i}
            className="rounded-lg border border-slate-200 bg-white p-2.5"
          >
            <p className="whitespace-pre-wrap break-words text-sm text-slate-800">
              {s}
            </p>
            <div className="mt-2 flex justify-end gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => handleUse(s)}
              >
                Use
              </Button>
              <Button size="sm" disabled={busy} onClick={() => onSend(s)}>
                Send
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={pendingUse !== null}
        title="Replace your reply?"
        message="The composer already contains text. Replace it with this suggestion?"
        confirmLabel="Replace"
        onConfirm={() => {
          if (pendingUse !== null) onUse(pendingUse);
          setPendingUse(null);
        }}
        onCancel={() => setPendingUse(null)}
      />
    </div>
  );
}
