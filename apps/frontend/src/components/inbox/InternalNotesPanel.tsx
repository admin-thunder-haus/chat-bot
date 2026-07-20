'use client';

import { useState } from 'react';
import { Button, Textarea } from '@/components/ui';
import { fullTime } from '@/lib/format';
import type { Note } from '@/lib/types';

export function InternalNotesPanel({
  notes,
  currentUserId,
  canManageAny,
  onAdd,
  onUpdate,
  onDelete,
}: {
  notes: Note[];
  currentUserId: string;
  canManageAny: boolean;
  onAdd: (content: string) => Promise<void>;
  onUpdate: (noteId: string, content: string) => Promise<void>;
  onDelete: (noteId: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  async function add() {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd(draft.trim());
      setDraft('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col p-3">
      {/* Distinct amber styling so notes never read as customer messages. */}
      <div className="mb-3 flex-1 space-y-2 overflow-y-auto">
        {notes.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No notes yet.</p>
        ) : (
          notes.map((note) => {
            const canManage = canManageAny || note.authorUserId === currentUserId;
            const isEditing = editingId === note.id;
            return (
              <div
                key={note.id}
                className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"
              >
                {isEditing ? (
                  <div className="space-y-2">
                    <Textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={async () => {
                          await onUpdate(note.id, editText.trim());
                          setEditingId(null);
                        }}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap break-words text-amber-900">
                      {note.content}
                    </p>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-amber-700">
                      <span>
                        {note.author?.fullName ?? 'Unknown'} ·{' '}
                        {fullTime(note.createdAt)}
                      </span>
                      {canManage && (
                        <span className="flex gap-2">
                          <button
                            type="button"
                            className="underline"
                            onClick={() => {
                              setEditingId(note.id);
                              setEditText(note.content);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="underline"
                            onClick={() => void onDelete(note.id)}
                          >
                            Delete
                          </button>
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-slate-200 pt-3">
        <Textarea
          placeholder="Add an internal note (only your team can see this)…"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="mt-2 flex justify-end">
          <Button size="sm" loading={busy} disabled={!draft.trim()} onClick={add}>
            Add note
          </Button>
        </div>
      </div>
    </div>
  );
}
