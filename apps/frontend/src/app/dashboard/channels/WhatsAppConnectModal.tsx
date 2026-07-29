'use client';

import { useEffect, useState } from 'react';
import { channelsApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { useToast } from '@/components/toast';
import { MetaOauthConnect } from './MetaOauthConnect';
import {
  Alert,
  Button,
  FieldError,
  Input,
  Label,
  Modal,
} from '@/components/ui';

/**
 * Connect a WhatsApp Business number. When Meta OAuth is configured the
 * primary path is one-click Embedded Signup ("Connect with Meta"); the manual
 * Cloud API credential form stays available as an advanced fallback. Secrets
 * (access token, app secret, verify token) are sent ONCE to the backend,
 * encrypted at rest, and NEVER returned.
 */
/** URL-safe random token, generated in the browser (never leaves this form). */
function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function WhatsAppConnectModal({
  open,
  onClose,
  onConnected,
  oauthAvailable = false,
}: {
  open: boolean;
  onClose: () => void;
  onConnected: () => void;
  oauthAvailable?: boolean;
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
  const [manualOpen, setManualOpen] = useState(false);

  // Reopening the dialog always starts on the recommended one-click path.
  useEffect(() => {
    if (!open) setManualOpen(false);
  }, [open]);

  // Give the verify token a value the operator never has to think about. It is
  // a secret WE choose and hand to Meta, not one Meta gives us, so an empty
  // required field just invites a guess (or a real secret pasted in by mistake).
  useEffect(() => {
    if (!open) return;
    setForm((f) => (f.verifyToken ? f : { ...f, verifyToken: randomToken() }));
  }, [open]);

  const showManual = !oauthAvailable || manualOpen;

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
    <Modal
      open={open}
      onClose={onClose}
      title="Connect WhatsApp Business"
      footer={
        showManual ? (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" form="whatsapp-connect-form" loading={saving}>
              Connect WhatsApp
            </Button>
          </>
        ) : (
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <MetaOauthConnect
        provider="whatsapp"
        providerLabel="WhatsApp Business number"
        oauthAvailable={oauthAvailable}
        manualOpen={manualOpen}
        onManualOpenChange={setManualOpen}
      >
        <form
          id="whatsapp-connect-form"
          onSubmit={submit}
          className="space-y-4"
        >
          <Alert variant="info">
            Enter your Meta Cloud API details. Secrets are encrypted at rest and
            never shown again. Point your Meta app webhook at this
            channel&apos;s URL and use the same verify token.
          </Alert>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="wa-name">Display name</Label>
              <Input
                id="wa-name"
                value={form.displayName}
                disabled={saving}
                invalid={Boolean(fieldErrors.displayName)}
                onChange={(e) => set('displayName', e.target.value)}
              />
              <FieldError message={fieldErrors.displayName} />
            </div>
            <div>
              <Label htmlFor="wa-display">Display phone number</Label>
              <Input
                id="wa-display"
                placeholder="+1 555 010 0000"
                value={form.displayPhoneNumber}
                disabled={saving}
                onChange={(e) => set('displayPhoneNumber', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="wa-pnid" required>
                Phone number ID
              </Label>
              <Input
                id="wa-pnid"
                value={form.phoneNumberId}
                disabled={saving}
                invalid={Boolean(fieldErrors.phoneNumberId)}
                onChange={(e) => set('phoneNumberId', e.target.value)}
              />
              <FieldError message={fieldErrors.phoneNumberId} />
            </div>
            <div>
              <Label htmlFor="wa-waba" required>
                Business account (WABA) ID
              </Label>
              <Input
                id="wa-waba"
                value={form.wabaId}
                disabled={saving}
                invalid={Boolean(fieldErrors.wabaId)}
                onChange={(e) => set('wabaId', e.target.value)}
              />
              <FieldError message={fieldErrors.wabaId} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="wa-biz">Business name</Label>
              <Input
                id="wa-biz"
                value={form.businessName}
                disabled={saving}
                onChange={(e) => set('businessName', e.target.value)}
              />
            </div>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="mb-2 text-xs font-semibold text-amber-800">
              Secrets — stored encrypted, never displayed again
            </p>
            <div className="space-y-3">
              <div>
                <Label htmlFor="wa-token" required>
                  Access token
                </Label>
                <Input
                  id="wa-token"
                  type="password"
                  autoComplete="off"
                  value={form.accessToken}
                  disabled={saving}
                  invalid={Boolean(fieldErrors.accessToken)}
                  onChange={(e) => set('accessToken', e.target.value)}
                />
                <FieldError message={fieldErrors.accessToken} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="wa-secret" required>
                    App secret
                  </Label>
                  <Input
                    id="wa-secret"
                    type="password"
                    autoComplete="off"
                    value={form.appSecret}
                    disabled={saving}
                    invalid={Boolean(fieldErrors.appSecret)}
                    onChange={(e) => set('appSecret', e.target.value)}
                  />
                  <FieldError message={fieldErrors.appSecret} />
                </div>
                <div>
                  <Label htmlFor="wa-verify" required>
                    Verify token
                  </Label>
                  <Input
                    id="wa-verify"
                    type="text"
                    autoComplete="off"
                    value={form.verifyToken}
                    disabled={saving}
                    invalid={Boolean(fieldErrors.verifyToken)}
                    onChange={(e) => set('verifyToken', e.target.value)}
                  />
                  {/* This field used to be an empty required box with no way to
                      know what belongs in it — the value is ours to choose, not
                      something Meta hands you. Pre-filling removes the decision
                      entirely; the note says why it usually does not matter. */}
                  <p className="mt-1 text-xs text-slate-500">
                    Generated for you. Only used if you point Meta&apos;s webhook at
                    this channel&apos;s own URL — with the shared webhook, leave it
                    as is.
                  </p>
                  <FieldError message={fieldErrors.verifyToken} />
                </div>
              </div>
            </div>
          </div>

          {error && <Alert message={error} />}
        </form>
      </MetaOauthConnect>
    </Modal>
  );
}
