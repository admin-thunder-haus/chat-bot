'use client';

import { Badge } from '@/components/ui';
import {
  channelLabel,
  customerName,
  PRIORITY_COLORS,
  relativeTime,
  STATUS_COLORS,
} from '@/lib/format';
import type { ConversationListItem as Conversation } from '@/lib/types';

/** Tags beyond this are folded into a "+N" chip so the row never wraps into a mess. */
const MAX_VISIBLE_TAGS = 2;

/** `OPEN` → "Open", `HIGH` → "High" — never show a raw enum (§8). */
function humanize(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
}

export function ConversationListItem({
  conversation,
  active,
  onClick,
}: {
  conversation: Conversation;
  active: boolean;
  onClick: () => void;
}) {
  const preview = conversation.messages[0];
  const name = customerName(conversation.customer);
  const unread = conversation.unreadCount > 0;
  const tags = conversation.tagAssignments.map((a) => a.tag);
  const visibleTags = tags.slice(0, MAX_VISIBLE_TAGS);
  const hiddenTags = tags.length - visibleTags.length;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={`w-full border-b border-slate-100 px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600 ${
        active ? 'bg-slate-100' : 'hover:bg-slate-50'
      }`}
    >
      <div className="flex items-start gap-2">
        {/* Unread rail: always present (transparent when read) so marking a
            conversation read never shifts the row. */}
        <span
          aria-hidden="true"
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
            unread ? 'bg-brand-600' : 'bg-transparent'
          }`}
        />

        <div className="min-w-0 flex-1">
          {/* Name · unread count · relative time */}
          <div className="flex items-center gap-2">
            <span
              title={name}
              className={`min-w-0 flex-1 truncate text-sm ${
                unread
                  ? 'font-semibold text-slate-900'
                  : 'font-medium text-slate-800'
              }`}
            >
              {name}
            </span>
            {unread && (
              <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] font-medium tabular-nums text-white">
                {conversation.unreadCount}
                <span className="sr-only"> unread messages</span>
              </span>
            )}
            <span className="shrink-0 text-xs tabular-nums text-slate-400">
              {relativeTime(conversation.lastMessageAt)}
            </span>
          </div>

          {/* Channel · subject */}
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="shrink-0">
              {channelLabel(conversation.channelType)}
            </span>
            {conversation.subject && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  title={conversation.subject}
                  className="truncate text-slate-500"
                >
                  {conversation.subject}
                </span>
              </>
            )}
          </div>

          {/* One-line preview */}
          <p
            className={`mt-1 truncate text-xs ${
              unread ? 'text-slate-700' : 'text-slate-500'
            }`}
          >
            {preview ? (
              <>
                {preview.direction === 'OUTBOUND' && (
                  <span className="text-slate-400">You: </span>
                )}
                {preview.content || 'Attachment'}
              </>
            ) : (
              <span className="text-slate-400">No messages yet</span>
            )}
          </p>

          {/* Status / priority / tags — at most four chips, so a wrap stays tidy */}
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <Badge color={STATUS_COLORS[conversation.status]}>
              {humanize(conversation.status)}
            </Badge>
            <Badge color={PRIORITY_COLORS[conversation.priority]}>
              {humanize(conversation.priority)}
            </Badge>
            {visibleTags.map((tag) => (
              <span
                key={tag.id}
                title={tag.name}
                className="max-w-[7rem] truncate rounded-full border px-1.5 text-[10px] leading-5"
                style={
                  tag.color
                    ? { borderColor: tag.color, color: tag.color }
                    : undefined
                }
              >
                {tag.name}
              </span>
            ))}
            {hiddenTags > 0 && (
              <span
                title={tags.map((t) => t.name).join(', ')}
                className="rounded-full border border-slate-200 px-1.5 text-[10px] leading-5 tabular-nums text-slate-500"
              >
                +{hiddenTags}
              </span>
            )}
          </div>

          {conversation.assignedUser && (
            <p className="mt-1 truncate text-[11px] text-slate-400">
              Assigned to {conversation.assignedUser.fullName}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}
