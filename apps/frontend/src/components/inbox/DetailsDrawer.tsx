'use client';

import { useEffect, useState } from 'react';
import type { Activity, ConversationDetail, Note } from '@/lib/types';
import { channelLabel, customerName, relativeTime } from '@/lib/format';
import { Button } from '@/components/ui';
import { CustomerDetails } from './CustomerDetails';
import { InternalNotesPanel } from './InternalNotesPanel';
import { ActivityTimeline } from './ActivityTimeline';

type Tab = 'details' | 'notes' | 'activity';

const TABS: { key: Tab; label: string }[] = [
  { key: 'details', label: 'Details' },
  { key: 'notes', label: 'Notes' },
  { key: 'activity', label: 'Activity' },
];

/**
 * Customer details, internal notes and the activity timeline.
 *
 * Below `sm` it is a full-screen sheet with its own header and close button (the
 * mobile navigation model: one pane at a time). At `sm+` it stays the familiar
 * right-hand drawer. Hidden by default; opened from the header.
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

  // The sheet covers the screen on a phone — stop the page behind it scrolling.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40"
      role="dialog"
      aria-modal="true"
      aria-label="Conversation details"
    >
      <div
        className="absolute inset-0 bg-slate-900/30"
        aria-hidden="true"
        onClick={onClose}
      />
      <aside className="absolute inset-0 flex flex-col bg-white shadow-xl sm:inset-y-0 sm:left-auto sm:right-0 sm:w-full sm:max-w-md">
        {/* Sheet header: who this is about + its own close control. */}
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">
              {customerName(detail.customer)}
            </p>
            <p className="truncate text-xs text-slate-400">
              {channelLabel(detail.channelType)}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close details"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div
          role="tablist"
          aria-label="Details sections"
          className="flex shrink-0 border-b border-slate-200"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`details-tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls={`details-panel-${t.key}`}
              onClick={() => setTab(t.key)}
              className={`min-h-11 flex-1 px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600 ${
                tab === t.key
                  ? 'border-b-2 border-brand-600 text-brand-700'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id={`details-panel-${tab}`}
          aria-labelledby={`details-tab-${tab}`}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]"
        >
          {tab === 'details' && (
            <>
              <CustomerDetails
                customer={detail.customer}
                canEdit={writable}
                saving={customerSaving}
                onSave={onSaveCustomer}
              />
              <div className="border-t border-slate-200 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">
                    AI summary
                  </h3>
                  <Button
                    variant="secondary"
                    className="w-full sm:w-auto"
                    loading={summaryLoading}
                    onClick={() => void generateSummary()}
                  >
                    {detail.aiSummary ? 'Regenerate' : 'Generate summary'}
                  </Button>
                </div>
                {detail.aiSummary ? (
                  <>
                    <p className="mt-2 whitespace-pre-line break-words text-sm text-slate-700">
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
                  <p className="mt-2 text-sm text-slate-500">
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
