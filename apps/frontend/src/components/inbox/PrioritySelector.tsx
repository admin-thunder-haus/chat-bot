'use client';

import { Select } from '@/components/ui';
import type { ConversationPriority } from '@/lib/types';

const OPTIONS: ConversationPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export function PrioritySelector({
  value,
  disabled,
  onChange,
}: {
  value: ConversationPriority;
  disabled?: boolean;
  onChange: (priority: ConversationPriority) => void;
}) {
  return (
    <Select
      aria-label="Conversation priority"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as ConversationPriority)}
      className="w-auto"
    >
      {OPTIONS.map((p) => (
        <option key={p} value={p}>
          {p.charAt(0) + p.slice(1).toLowerCase()}
        </option>
      ))}
    </Select>
  );
}
