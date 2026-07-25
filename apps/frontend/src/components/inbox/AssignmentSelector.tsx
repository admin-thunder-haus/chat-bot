'use client';

import { Select } from '@/components/ui';
import type { UserSummary } from '@/lib/types';

export function AssignmentSelector({
  value,
  users,
  disabled,
  className = '!w-auto max-w-48',
  onChange,
}: {
  value: string | null;
  users: UserSummary[];
  disabled?: boolean;
  /**
   * Pass `w-full` when the selector lives in the mobile overflow panel.
   * The default needs `!` because the shared `Select` hardcodes `w-full`.
   */
  className?: string;
  onChange: (userId: string | null) => void;
}) {
  return (
    <Select
      aria-label="Assign conversation"
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      className={className}
    >
      <option value="">Unassigned</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.fullName}
        </option>
      ))}
    </Select>
  );
}
