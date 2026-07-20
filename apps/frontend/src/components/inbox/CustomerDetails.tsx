'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Label } from '@/components/ui';
import { channelLabel, fullTime } from '@/lib/format';
import type { Customer } from '@/lib/types';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-2 last:border-0">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="text-right text-sm text-slate-800">{value || '—'}</span>
    </div>
  );
}

export function CustomerDetails({
  customer,
  canEdit,
  saving,
  onSave,
}: {
  customer: Customer;
  canEdit: boolean;
  saving: boolean;
  onSave: (patch: {
    fullName?: string | null;
    phone?: string | null;
    email?: string | null;
    username?: string | null;
    notes?: string | null;
  }) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    fullName: customer.fullName ?? '',
    phone: customer.phone ?? '',
    email: customer.email ?? '',
    username: customer.username ?? '',
    notes: customer.notes ?? '',
  });

  useEffect(() => {
    setForm({
      fullName: customer.fullName ?? '',
      phone: customer.phone ?? '',
      email: customer.email ?? '',
      username: customer.username ?? '',
      notes: customer.notes ?? '',
    });
    setEditing(false);
  }, [customer]);

  if (editing) {
    return (
      <div className="space-y-3 p-3">
        {(['fullName', 'phone', 'email', 'username', 'notes'] as const).map(
          (key) => (
            <div key={key}>
              <Label htmlFor={`cust-${key}`}>{key}</Label>
              <Input
                id={`cust-${key}`}
                value={form[key]}
                disabled={saving}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              />
            </div>
          ),
        )}
        <div className="flex gap-2">
          <Button
            loading={saving}
            onClick={async () => {
              await onSave(form);
              setEditing(false);
            }}
          >
            Save
          </Button>
          <Button variant="secondary" disabled={saving} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3">
      <Row label="Name" value={customer.fullName ?? ''} />
      <Row label="Phone" value={customer.phone ?? ''} />
      <Row label="Email" value={customer.email ?? ''} />
      <Row label="Username" value={customer.username ?? ''} />
      <Row label="Channel" value={channelLabel(customer.channelType)} />
      <Row label="First seen" value={fullTime(customer.firstSeenAt)} />
      <Row label="Last seen" value={fullTime(customer.lastSeenAt)} />
      <Row label="Notes" value={customer.notes ?? ''} />
      {canEdit && (
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            Edit customer
          </Button>
        </div>
      )}
    </div>
  );
}
