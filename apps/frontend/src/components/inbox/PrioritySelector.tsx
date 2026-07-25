'use client';

import { Select } from '@/components/ui';
import type { ConversationPriority } from '@/lib/types';

const OPTIONS: ConversationPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export function PrioritySelector({
  value,
  disabled,
  className = '!w-auto',
  onChange,
}: {
  value: ConversationPriority;
  disabled?: boolean;
  /**
   * Pass `w-full` when the selector lives in the mobile overflow panel.
   * The default needs `!` because the shared `Select` hardcodes `w-full`.
   */
  className?: string;
  onChange: (priority: ConversationPriority) => void;
}) {
  return (
    <Select
      aria-label="Conversation priority"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as ConversationPriority)}
      className={className}
    >
      {OPTIONS.map((p) => (
        <option key={p} value={p}>
          {p.charAt(0) + p.slice(1).toLowerCase()}
        </option>
      ))}
    </Select>
  );
}
