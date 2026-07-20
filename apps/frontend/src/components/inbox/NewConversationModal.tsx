'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Input, Label, Modal, Select, Textarea } from '@/components/ui';
import { conversationsApi, customersApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { customerName } from '@/lib/format';
import type { Customer } from '@/lib/types';

export function NewConversationModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [subject, setSubject] = useState('');
  const [initialMessage, setInitialMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setSubject('');
    setInitialMessage('');
    customersApi
      .list({ limit: 100, sortBy: 'fullName', sortOrder: 'asc' })
      .then((res) => {
        setCustomers(res.items);
        setCustomerId(res.items[0]?.id ?? '');
      })
      .catch((err) => setError(parseApiError(err).message));
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId) {
      setError('Please select a customer.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { conversation } = await conversationsApi.create({
        customerId,
        subject: subject.trim() || undefined,
        initialMessage: initialMessage.trim() || undefined,
      });
      onCreated(conversation.id);
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New conversation">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert message={error} />}
        <div>
          <Label htmlFor="nc-customer" required>
            Customer
          </Label>
          {customers.length === 0 ? (
            <p className="text-sm text-slate-500">
              No customers yet. Create one first (or use the mock message tool).
            </p>
          ) : (
            <Select
              id="nc-customer"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {customerName(c)}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div>
          <Label htmlFor="nc-subject">Subject</Label>
          <Input
            id="nc-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="nc-msg">Initial message (optional, logged as outbound)</Label>
          <Textarea
            id="nc-msg"
            value={initialMessage}
            onChange={(e) => setInitialMessage(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!customerId}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}
