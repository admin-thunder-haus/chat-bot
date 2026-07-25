'use client';

import { Select } from '@/components/ui';
import type { ConversationStatus } from '@/lib/types';

const OPTIONS: ConversationStatus[] = ['OPEN', 'PENDING', 'RESOLVED', 'CLOSED'];

export function StatusSelector({
  value,
  disabled,
  className = '!w-auto',
  onChange,
}: {
  value: ConversationStatus;
  disabled?: boolean;
  /**
   * Pass `w-full` when the selector lives in the mobile overflow panel.
   * The default needs `!` because the shared `Select` hardcodes `w-full`, which
   * Tailwind emits after `w-auto` and would otherwise win.
   */
  className?: string;
  onChange: (status: ConversationStatus) => void;
}) {
  return (
    <Select
      aria-label="Conversation status"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as ConversationStatus)}
      className={className}
    >
      {OPTIONS.map((s) => (
        <option key={s} value={s}>
          {s.charAt(0) + s.slice(1).toLowerCase()}
        </option>
      ))}
    </Select>
  );
}
