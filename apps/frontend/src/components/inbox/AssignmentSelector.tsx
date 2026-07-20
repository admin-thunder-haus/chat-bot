'use client';

import { Select } from '@/components/ui';
import type { UserSummary } from '@/lib/types';

export function AssignmentSelector({
  value,
  users,
  disabled,
  onChange,
}: {
  value: string | null;
  users: UserSummary[];
  disabled?: boolean;
  onChange: (userId: string | null) => void;
}) {
  return (
    <Select
      aria-label="Assign conversation"
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      className="w-auto"
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
