'use client';

import { useState } from 'react';
import { Input, Select } from '@/components/ui';
import type { Tag } from '@/lib/types';
import type { FilterState } from './filter-types';

const CLEARED: Omit<FilterState, 'search'> = {
  status: '',
  priority: '',
  channelType: '',
  assignment: 'all',
  tagId: '',
  unreadOnly: false,
  archived: false,
};

function countActive(value: FilterState): number {
  return (
    (value.status ? 1 : 0) +
    (value.priority ? 1 : 0) +
    (value.channelType ? 1 : 0) +
    (value.tagId ? 1 : 0) +
    (value.assignment !== 'all' ? 1 : 0) +
    (value.unreadOnly ? 1 : 0) +
    (value.archived ? 1 : 0)
  );
}

/** Full-width control per §5; `Select` already supplies the 40px tap target. */
const selectClass = 'w-full';

export function ConversationFilters({
  value,
  tags,
  onChange,
}: {
  value: FilterState;
  tags: Tag[];
  onChange: (patch: Partial<FilterState>) => void;
}) {
  // Search is ALWAYS visible. The dropdown filters collapse below `lg` only, so
  // a phone is not handed six controls before it reaches the first conversation.
  const [open, setOpen] = useState(false);
  const activeCount = countActive(value);

  return (
    <div className="space-y-2 border-b border-slate-200 p-3">
      <div className="flex items-center gap-2">
        <Input
          type="search"
          placeholder="Search conversations…"
          value={value.search}
          onChange={(e) => onChange({ search: e.target.value })}
          aria-label="Search conversations"
          className="min-w-0 flex-1"
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 lg:hidden"
        >
          Filters
          {activeCount > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] tabular-nums text-white">
              {activeCount}
            </span>
          )}
          <span aria-hidden="true" className="text-xs text-slate-400">
            {open ? '▴' : '▾'}
          </span>
        </button>
      </div>

      <div
        className={`${open ? 'grid' : 'hidden lg:grid'} grid-cols-1 gap-2 lg:grid-cols-2`}
      >
        <Select
          aria-label="Filter by status"
          value={value.status}
          className={selectClass}
          onChange={(e) =>
            onChange({ status: e.target.value as FilterState['status'] })
          }
        >
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="PENDING">Pending</option>
          <option value="RESOLVED">Resolved</option>
          <option value="CLOSED">Closed</option>
        </Select>
        <Select
          aria-label="Filter by priority"
          value={value.priority}
          className={selectClass}
          onChange={(e) =>
            onChange({ priority: e.target.value as FilterState['priority'] })
          }
        >
          <option value="">All priorities</option>
          <option value="LOW">Low</option>
          <option value="NORMAL">Normal</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </Select>
        <Select
          aria-label="Filter by assignment"
          value={value.assignment}
          className={selectClass}
          onChange={(e) =>
            onChange({ assignment: e.target.value as FilterState['assignment'] })
          }
        >
          <option value="all">All assignments</option>
          <option value="mine">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
        </Select>
        <Select
          aria-label="Filter by channel"
          value={value.channelType}
          className={selectClass}
          onChange={(e) =>
            onChange({ channelType: e.target.value as FilterState['channelType'] })
          }
        >
          <option value="">All channels</option>
          <option value="MANUAL">Manual</option>
          <option value="WEBCHAT">Web chat</option>
          <option value="WHATSAPP">WhatsApp</option>
          <option value="INSTAGRAM">Instagram</option>
          <option value="FACEBOOK">Facebook</option>
          <option value="TELEGRAM">Telegram</option>
          <option value="EMAIL">Email</option>
        </Select>
        <Select
          aria-label="Filter by tag"
          value={value.tagId}
          className={selectClass}
          onChange={(e) => onChange({ tagId: e.target.value })}
        >
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>

        <div className="flex flex-wrap items-center gap-x-4 text-sm text-slate-600">
          <label className="inline-flex min-h-10 items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              checked={value.unreadOnly}
              onChange={(e) => onChange({ unreadOnly: e.target.checked })}
            />
            Unread
          </label>
          <label className="inline-flex min-h-10 items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              checked={value.archived}
              onChange={(e) => onChange({ archived: e.target.checked })}
            />
            Archived
          </label>
        </div>

        {activeCount > 0 && (
          <div className="lg:col-span-2">
            <button
              type="button"
              onClick={() => onChange(CLEARED)}
              className="inline-flex min-h-10 items-center rounded-lg px-1 text-sm font-medium text-slate-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
