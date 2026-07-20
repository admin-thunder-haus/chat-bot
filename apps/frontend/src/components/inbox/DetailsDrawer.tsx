'use client';

import { useEffect, useState } from 'react';
import type { Activity, ConversationDetail, Note } from '@/lib/types';
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
}) {
  const [tab, setTab] = useState<Tab>('details');

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
            <CustomerDetails
              customer={detail.customer}
              canEdit={writable}
              saving={customerSaving}
              onSave={onSaveCustomer}
            />
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
