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

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full border-b border-slate-100 px-3 py-3 text-left transition hover:bg-slate-50 ${
        active ? 'bg-slate-100' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-slate-900">{name}</span>
        <span className="shrink-0 text-xs text-slate-400">
          {relativeTime(conversation.lastMessageAt)}
        </span>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <span className="text-[11px] text-slate-400">
          {channelLabel(conversation.channelType)}
        </span>
        {conversation.subject && (
          <span className="truncate text-xs text-slate-500">
            {conversation.subject}
          </span>
        )}
      </div>

      {preview && (
        <p className="mt-1 line-clamp-1 text-xs text-slate-500">
          {preview.direction === 'OUTBOUND' ? 'You: ' : ''}
          {preview.content}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <Badge color={STATUS_COLORS[conversation.status]}>
          {conversation.status.toLowerCase()}
        </Badge>
        <Badge color={PRIORITY_COLORS[conversation.priority]}>
          {conversation.priority.toLowerCase()}
        </Badge>
        {conversation.assignedUser && (
          <span className="text-[11px] text-slate-400">
            @{conversation.assignedUser.fullName}
          </span>
        )}
        {conversation.tagAssignments.map(({ tag }) => (
          <span
            key={tag.id}
            className="rounded-full border px-1.5 text-[10px]"
            style={tag.color ? { borderColor: tag.color, color: tag.color } : undefined}
          >
            {tag.name}
          </span>
        ))}
        {conversation.unreadCount > 0 && (
          <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-900 px-1.5 text-[11px] font-medium text-white">
            {conversation.unreadCount}
          </span>
        )}
      </div>
    </button>
  );
}
