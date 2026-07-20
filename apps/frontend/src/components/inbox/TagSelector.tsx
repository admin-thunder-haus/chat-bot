'use client';

import { useState } from 'react';
import { Select } from '@/components/ui';
import type { Tag } from '@/lib/types';

/** Shows assigned tags as removable chips plus a dropdown to add existing tags. */
export function TagSelector({
  assigned,
  all,
  disabled,
  onAttach,
  onDetach,
}: {
  assigned: Tag[];
  all: Tag[];
  disabled?: boolean;
  onAttach: (tagId: string) => void;
  onDetach: (tagId: string) => void;
}) {
  const [selected, setSelected] = useState('');
  const assignedIds = new Set(assigned.map((t) => t.id));
  const available = all.filter((t) => !assignedIds.has(t.id));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {assigned.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
          style={
            tag.color
              ? { borderColor: tag.color, color: tag.color }
              : undefined
          }
        >
          {tag.name}
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove tag ${tag.name}`}
              onClick={() => onDetach(tag.id)}
              className="text-slate-400 hover:text-slate-700"
            >
              ✕
            </button>
          )}
        </span>
      ))}

      {!disabled && available.length > 0 && (
        <Select
          aria-label="Add tag"
          value={selected}
          onChange={(e) => {
            const id = e.target.value;
            if (id) {
              onAttach(id);
              setSelected('');
            }
          }}
          className="w-auto text-xs"
        >
          <option value="">+ Add tag</option>
          {available.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
