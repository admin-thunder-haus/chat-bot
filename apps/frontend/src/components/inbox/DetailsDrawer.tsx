'use client';

import { useEffect, useState } from 'react';
import type { Activity, ConversationDetail, Note } from '@/lib/types';
import { relativeTime } from '@/lib/format';
import { Button } from '@/components/ui';
import { CustomerDetails } from './CustomerDetails';
import { InternalNotesPanel } from './InternalNotesPanel';
import { ActivityTimeline } from './ActivityTimeline';

type Tab = 'details' | 'notes' | 'activity';

/**
 * Right-side drawer holding Customer details, Internal notes, and the Activity
 * timeline. Hidden by default; opened via the header "Details" button.
 */
export function DetailsDrawer({
  open,
  onClose,
  detail,
  notes,
  activities,
  currentUserId,
  writable,
  customerSaving,
  onSaveCustomer,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onGenerateSummary,
}: {
  open: boolean;
  onClose: () => void;
  detail: ConversationDetail;
  notes: Note[];
  activities: Activity[];
  currentUserId: string;
  writable: boolean;
  customerSaving: boolean;
  onSaveCustomer: (patch: Record<string, string | null>) => Promise<void>;
  onAddNote: (content: string) => Promise<void>;
  onUpdateNote: (noteId: string, content: string) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onGenerateSummary: () => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>('details');
  const [summaryLoading, setSummaryLoading] = useState(false);

  async function generateSummary() {
    setSummaryLoading(true);
    try {
      await onGenerateSummary();
    } finally {
      setSummaryLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Details">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-xl">
        <div className="flex items-center border-b border-slate-200">
          {(['details', 'notes', 'activity'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 px-3 py-3 text-sm font-medium capitalize ${
                tab === t
                  ? 'border-b-2 border-slate-900 text-slate-900'
                  : 'text-slate-500'
              }`}
            >
              {t}
            </button>
          ))}
          <button
            type="button"
            aria-label="Close details"
            onClick={onClose}
            className="px-3 py-3 text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'details' && (
            <>
              <CustomerDetails
                customer={detail.customer}
                canEdit={writable}
                saving={customerSaving}
                onSave={onSaveCustomer}
              />
              <div className="border-t border-slate-200 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    AI summary
                  </h3>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={summaryLoading}
                    onClick={() => void generateSummary()}
                  >
                    {detail.aiSummary ? 'Regenerate' : 'Generate summary'}
                  </Button>
                </div>
                {detail.aiSummary ? (
                  <>
                    <p className="mt-2 whitespace-pre-line text-sm text-slate-700">
                      {detail.aiSummary}
                    </p>
                    {detail.aiSummaryGeneratedAt && (
                      <p className="mt-1.5 text-[11px] text-slate-400">
                        Generated{' '}
                        {relativeTime(detail.aiSummaryGeneratedAt) === 'now'
                          ? 'just now'
                          : `${relativeTime(detail.aiSummaryGeneratedAt)} ago`}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-2 text-sm text-slate-400">
                    No summary yet. Generate one for a quick recap of this
                    conversation.
                  </p>
                )}
              </div>
            </>
          )}
          {tab === 'notes' && (
            <InternalNotesPanel
              notes={notes}
              currentUserId={currentUserId}
              canManageAny={writable}
              onAdd={onAddNote}
              onUpdate={onUpdateNote}
              onDelete={onDeleteNote}
            />
          )}
          {tab === 'activity' && <ActivityTimeline activities={activities} />}
        </div>
      </aside>
    </div>
  );
}
