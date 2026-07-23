'use client';

import { useState } from 'react';
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
 * Connect a Facebook Page via the Meta Messenger Platform. When Meta OAuth is
 * configured the primary path is "Connect with Meta" (Facebook Login for
 * Business); the manual credential form stays as an advanced fallback.
 * Secrets (page access token, app secret, verify token) are sent ONCE to the
 * backend, encrypted at rest, and NEVER returned. On submit the backend
 * validates them against the Graph API, so the reported state is honest
 * (verified / auth-expired / pending).
 */
export function FacebookConnectModal({
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
    displayName: 'Facebook Messenger',
    pageId: '',
    pageName: '',
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
      const { account } = await channelsApi.connectFacebook({
        displayName: form.displayName.trim(),
        pageId: form.pageId.trim(),
        pageName: form.pageName.trim() || undefined,
        businessName: form.businessName.trim() || undefined,
        accessToken: form.accessToken.trim(),
        appSecret: form.appSecret.trim(),
        verifyToken: form.verifyToken.trim(),
      });
      if (account.connectionState === 'HEALTHY') {
        notify('Facebook Messenger connection verified and active', 'success');
      } else if (account.connectionState === 'AUTH_EXPIRED') {
        notify('Saved, but authentication failed — check the Page access token', 'error');
      } else {
        notify('Facebook credentials saved; verification pending', 'success');
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
    <Modal open={open} onClose={onClose} title="Connect Facebook Messenger">
      <MetaOauthConnect provider="facebook" providerLabel="Facebook Page" oauthAvailable={oauthAvailable}>
      <form onSubmit={submit} className="space-y-4">
        <Alert variant="info">
          Enter your Meta Messenger details. Secrets are encrypted at rest and
          never shown again. On save we validate the credentials against Meta and
          point you at this channel&apos;s webhook URL.
        </Alert>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-xs font-semibold text-slate-700">
            Before you connect, make sure you have:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
            <li>A Facebook Page you manage</li>
            <li>A Meta app with the Messenger product and permissions</li>
            <li>A valid Page access token with pages_messaging</li>
            <li>The Meta webhook configured for this channel&apos;s URL</li>
          </ul>
          <p className="mt-2 text-[11px] text-slate-400">
            Prefer the one-click &quot;Connect with Meta&quot; option when it is
            shown above — this manual form is the advanced fallback.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="fb-name">Display name</Label>
            <Input id="fb-name" value={form.displayName} disabled={saving} onChange={(e) => set('displayName', e.target.value)} />
            <FieldError message={fieldErrors.displayName} />
          </div>
          <div>
            <Label htmlFor="fb-pagename">Page name</Label>
            <Input id="fb-pagename" placeholder="Acme Support" value={form.pageName} disabled={saving} onChange={(e) => set('pageName', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="fb-page" required>Facebook Page ID</Label>
            <Input id="fb-page" value={form.pageId} disabled={saving} onChange={(e) => set('pageId', e.target.value)} />
            <FieldError message={fieldErrors.pageId} />
          </div>
          <div>
            <Label htmlFor="fb-biz">Business name</Label>
            <Input id="fb-biz" value={form.businessName} disabled={saving} onChange={(e) => set('businessName', e.target.value)} />
          </div>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-xs font-semibold text-amber-800">
            Secrets (stored encrypted, never displayed again)
          </p>
          <div className="space-y-3">
            <div>
              <Label htmlFor="fb-token" required>Page access token</Label>
              <Input id="fb-token" type="password" autoComplete="off" value={form.accessToken} disabled={saving} onChange={(e) => set('accessToken', e.target.value)} />
              <FieldError message={fieldErrors.accessToken} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="fb-secret" required>App secret</Label>
                <Input id="fb-secret" type="password" autoComplete="off" value={form.appSecret} disabled={saving} onChange={(e) => set('appSecret', e.target.value)} />
                <FieldError message={fieldErrors.appSecret} />
              </div>
              <div>
                <Label htmlFor="fb-verify" required>Verify token</Label>
                <Input id="fb-verify" type="password" autoComplete="off" value={form.verifyToken} disabled={saving} onChange={(e) => set('verifyToken', e.target.value)} />
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
            Connect Facebook
          </Button>
        </div>
      </form>
      </MetaOauthConnect>
    </Modal>
  );
}
