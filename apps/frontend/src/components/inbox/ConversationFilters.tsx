'use client';

import { Input, Select } from '@/components/ui';
import type { Tag } from '@/lib/types';
import type { FilterState } from './filter-types';

export function ConversationFilters({
  value,
  tags,
  onChange,
}: {
  value: FilterState;
  tags: Tag[];
  onChange: (patch: Partial<FilterState>) => void;
}) {
  return (
    <div className="space-y-2 border-b border-slate-200 p-3">
      <Input
        placeholder="Search conversations…"
        value={value.search}
        onChange={(e) => onChange({ search: e.target.value })}
        aria-label="Search conversations"
      />
      <div className="grid grid-cols-2 gap-2">
        <Select
          aria-label="Filter by status"
          value={value.status}
          onChange={(e) => onChange({ status: e.target.value as FilterState['status'] })}
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
          onChange={(e) => onChange({ tagId: e.target.value })}
        >
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-3 text-xs text-slate-600">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={value.unreadOnly}
              onChange={(e) => onChange({ unreadOnly: e.target.checked })}
            />
            Unread
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={value.archived}
              onChange={(e) => onChange({ archived: e.target.checked })}
            />
            Archived
          </label>
        </div>
      </div>
    </div>
  );
}
