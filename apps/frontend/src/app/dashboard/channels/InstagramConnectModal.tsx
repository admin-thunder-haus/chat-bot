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
 * Connect an Instagram professional account via the Meta Instagram Messaging
 * API. When Meta OAuth is configured the primary path is "Connect with Meta"
 * (picks the Instagram account linked to your Facebook Page); the manual
 * credential form stays as an advanced fallback. Secrets (access token, app
 * secret, verify token) are sent ONCE to the backend, encrypted at rest, and
 * NEVER returned. On submit the backend also validates the credentials
 * against the Graph API, so the reported state is honest.
 */
export function InstagramConnectModal({
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
    displayName: 'Instagram',
    instagramAccountId: '',
    instagramUsername: '',
    facebookPageId: '',
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
      const { account } = await channelsApi.connectInstagram({
        displayName: form.displayName.trim(),
        instagramAccountId: form.instagramAccountId.trim(),
        instagramUsername: form.instagramUsername.trim() || undefined,
        facebookPageId: form.facebookPageId.trim() || undefined,
        businessName: form.businessName.trim() || undefined,
        accessToken: form.accessToken.trim(),
        appSecret: form.appSecret.trim(),
        verifyToken: form.verifyToken.trim(),
      });
      // Honest, state-aware feedback (never a blind "connected").
      if (account.connectionState === 'HEALTHY') {
        notify('Instagram connection verified and active', 'success');
      } else if (account.connectionState === 'AUTH_EXPIRED') {
        notify(
          'Saved, but authentication failed — check the access token',
          'error',
        );
      } else {
        notify('Instagram credentials saved; verification pending', 'success');
      }
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
      title="Connect Instagram"
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
            <Button
              type="submit"
              form="instagram-connect-form"
              loading={saving}
            >
              Connect Instagram
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
        provider="instagram"
        providerLabel="Instagram professional account"
        oauthAvailable={oauthAvailable}
        manualOpen={manualOpen}
        onManualOpenChange={setManualOpen}
      >
        <form
          id="instagram-connect-form"
          onSubmit={submit}
          className="space-y-4"
        >
          <Alert variant="info">
            Enter your Meta Instagram Messaging details. Secrets are encrypted
            at rest and never shown again. On save we validate the credentials
            against Meta and point you at this channel&apos;s webhook URL.
          </Alert>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-xs font-semibold text-slate-700">
              Before you connect, your account needs:
            </p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
              <li>
                An eligible Instagram professional (Business or Creator) account
              </li>
              <li>A connected Facebook Page, where your setup requires one</li>
              <li>
                A Meta app with the Instagram messaging product and permissions
              </li>
              <li>
                A valid access token with <code>instagram_manage_messages</code>
              </li>
              <li>The Meta webhook configured for this channel&apos;s URL</li>
            </ul>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ig-name">Display name</Label>
              <Input
                id="ig-name"
                value={form.displayName}
                disabled={saving}
                invalid={Boolean(fieldErrors.displayName)}
                onChange={(e) => set('displayName', e.target.value)}
              />
              <FieldError message={fieldErrors.displayName} />
            </div>
            <div>
              <Label htmlFor="ig-username">Instagram username</Label>
              <Input
                id="ig-username"
                placeholder="acme.support"
                value={form.instagramUsername}
                disabled={saving}
                onChange={(e) => set('instagramUsername', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ig-account" required>
                Instagram account ID
              </Label>
              <Input
                id="ig-account"
                value={form.instagramAccountId}
                disabled={saving}
                invalid={Boolean(fieldErrors.instagramAccountId)}
                onChange={(e) => set('instagramAccountId', e.target.value)}
              />
              <FieldError message={fieldErrors.instagramAccountId} />
            </div>
            <div>
              <Label htmlFor="ig-page">Facebook Page ID</Label>
              <Input
                id="ig-page"
                value={form.facebookPageId}
                disabled={saving}
                invalid={Boolean(fieldErrors.facebookPageId)}
                onChange={(e) => set('facebookPageId', e.target.value)}
              />
              <FieldError message={fieldErrors.facebookPageId} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ig-biz">Business name</Label>
              <Input
                id="ig-biz"
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
                <Label htmlFor="ig-token" required>
                  Access token
                </Label>
                <Input
                  id="ig-token"
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
                  <Label htmlFor="ig-secret" required>
                    App secret
                  </Label>
                  <Input
                    id="ig-secret"
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
                  <Label htmlFor="ig-verify" required>
                    Verify token
                  </Label>
                  <Input
                    id="ig-verify"
                    type="password"
                    autoComplete="off"
                    value={form.verifyToken}
                    disabled={saving}
                    invalid={Boolean(fieldErrors.verifyToken)}
                    onChange={(e) => set('verifyToken', e.target.value)}
                  />
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
