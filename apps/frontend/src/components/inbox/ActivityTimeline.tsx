'use client';

import { fullTime } from '@/lib/format';
import type { Activity, ActivityType } from '@/lib/types';

const LABELS: Record<ActivityType, string> = {
  CONVERSATION_CREATED: 'Conversation created',
  MESSAGE_RECEIVED: 'Message received',
  MESSAGE_SENT: 'Message sent',
  NOTE_ADDED: 'Note added',
  ASSIGNEE_CHANGED: 'Assignment changed',
  STATUS_CHANGED: 'Status changed',
  PRIORITY_CHANGED: 'Priority changed',
  TAG_ADDED: 'Tag added',
  TAG_REMOVED: 'Tag removed',
  CUSTOMER_UPDATED: 'Customer updated',
  AI_MODE_CHANGED: 'AI mode changed',
  AI_HANDOFF_REQUESTED: 'Human handoff requested',
};

function detail(a: Activity): string {
  if (a.activityType === 'STATUS_CHANGED' && a.newValue?.status) {
    return `→ ${String(a.newValue.status).toLowerCase()}`;
  }
  if (a.activityType === 'PRIORITY_CHANGED' && a.newValue?.priority) {
    return `→ ${String(a.newValue.priority).toLowerCase()}`;
  }
  if (a.activityType === 'TAG_ADDED' && a.newValue?.name) {
    return `"${String(a.newValue.name)}"`;
  }
  if (a.activityType === 'TAG_REMOVED' && a.previousValue?.name) {
    return `"${String(a.previousValue.name)}"`;
  }
  return '';
}

export function ActivityTimeline({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-slate-400">No activity yet.</p>
    );
  }
  return (
    <ol className="space-y-3 p-3">
      {activities.map((a) => (
        <li key={a.id} className="flex gap-3 text-sm">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-300" />
          <div>
            <p className="text-slate-800">
              {LABELS[a.activityType]}{' '}
              <span className="text-slate-500">{detail(a)}</span>
            </p>
            <p className="text-[11px] text-slate-400">{fullTime(a.createdAt)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
