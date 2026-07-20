'use client';

import { useState } from 'react';
import { channelsApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { useToast } from '@/components/toast';
import {
  Alert,
  Button,
  FieldError,
  Input,
  Label,
  Modal,
} from '@/components/ui';

/**
 * Connect a WhatsApp Business number via the Meta Cloud API. Secrets (access
 * token, app secret, verify token) are sent ONCE to the backend, encrypted at
 * rest, and NEVER returned. This form is the only place they are entered.
 */
export function WhatsAppConnectModal({
  open,
  onClose,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  onConnected: () => void;
}) {
  const { notify } = useToast();
  const [form, setForm] = useState({
    displayName: 'WhatsApp',
    phoneNumberId: '',
    wabaId: '',
    displayPhoneNumber: '',
    businessName: '',
    accessToken: '',
    appSecret: '',
    verifyToken: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setFieldErrors({});
    setSaving(true);
    try {
      await channelsApi.connectWhatsApp({
        displayName: form.displayName.trim(),
        phoneNumberId: form.phoneNumberId.trim(),
        wabaId: form.wabaId.trim(),
        displayPhoneNumber: form.displayPhoneNumber.trim() || undefined,
        businessName: form.businessName.trim() || undefined,
        accessToken: form.accessToken.trim(),
        appSecret: form.appSecret.trim(),
        verifyToken: form.verifyToken.trim(),
      });
      notify('WhatsApp connected', 'success');
      onConnected();
      onClose();
    } catch (err) {
      const parsed = parseApiError(err);
      setError(parsed.message);
      setFieldErrors(parsed.fieldErrors);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Connect WhatsApp Business">
      <form onSubmit={submit} className="space-y-4">
        <Alert variant="info">
          Enter your Meta Cloud API details. Secrets are encrypted at rest and
          never shown again. Configure your Meta app webhook to point at this
          channel&apos;s URL and use the same verify token.
        </Alert>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="wa-name">Display name</Label>
            <Input id="wa-name" value={form.displayName} disabled={saving} onChange={(e) => set('displayName', e.target.value)} />
            <FieldError message={fieldErrors.displayName} />
          </div>
          <div>
            <Label htmlFor="wa-display">Display phone number</Label>
            <Input id="wa-display" placeholder="+1 555 010 0000" value={form.displayPhoneNumber} disabled={saving} onChange={(e) => set('displayPhoneNumber', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="wa-pnid" required>Phone Number ID</Label>
            <Input id="wa-pnid" value={form.phoneNumberId} disabled={saving} onChange={(e) => set('phoneNumberId', e.target.value)} />
            <FieldError message={fieldErrors.phoneNumberId} />
          </div>
          <div>
            <Label htmlFor="wa-waba" required>Business Account (WABA) ID</Label>
            <Input id="wa-waba" value={form.wabaId} disabled={saving} onChange={(e) => set('wabaId', e.target.value)} />
            <FieldError message={fieldErrors.wabaId} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="wa-biz">Business name</Label>
            <Input id="wa-biz" value={form.businessName} disabled={saving} onChange={(e) => set('businessName', e.target.value)} />
          </div>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-xs font-semibold text-amber-800">
            Secrets (stored encrypted, never displayed again)
          </p>
          <div className="space-y-3">
            <div>
              <Label htmlFor="wa-token" required>Access token</Label>
              <Input id="wa-token" type="password" autoComplete="off" value={form.accessToken} disabled={saving} onChange={(e) => set('accessToken', e.target.value)} />
              <FieldError message={fieldErrors.accessToken} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="wa-secret" required>App secret</Label>
                <Input id="wa-secret" type="password" autoComplete="off" value={form.appSecret} disabled={saving} onChange={(e) => set('appSecret', e.target.value)} />
                <FieldError message={fieldErrors.appSecret} />
              </div>
              <div>
                <Label htmlFor="wa-verify" required>Verify token</Label>
                <Input id="wa-verify" type="password" autoComplete="off" value={form.verifyToken} disabled={saving} onChange={(e) => set('verifyToken', e.target.value)} />
                <FieldError message={fieldErrors.verifyToken} />
              </div>
            </div>
          </div>
        </div>

        {error && <Alert message={error} />}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Connect WhatsApp
          </Button>
        </div>
      </form>
    </Modal>
  );
}
