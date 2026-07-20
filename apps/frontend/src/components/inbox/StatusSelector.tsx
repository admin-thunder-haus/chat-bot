'use client';

import { Select } from '@/components/ui';
import type { ConversationStatus } from '@/lib/types';

const OPTIONS: ConversationStatus[] = ['OPEN', 'PENDING', 'RESOLVED', 'CLOSED'];

export function StatusSelector({
  value,
  disabled,
  onChange,
}: {
  value: ConversationStatus;
  disabled?: boolean;
  onChange: (status: ConversationStatus) => void;
}) {
  return (
    <Select
      aria-label="Conversation status"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as ConversationStatus)}
      className="w-auto"
    >
      {OPTIONS.map((s) => (
        <option key={s} value={s}>
          {s.charAt(0) + s.slice(1).toLowerCase()}
        </option>
      ))}
    </Select>
  );
}
