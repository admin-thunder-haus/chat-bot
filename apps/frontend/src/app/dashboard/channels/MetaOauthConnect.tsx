'use client';

import { useState } from 'react';
import { channelsApi } from '@/lib/resources';
import type { MetaOauthProvider } from '@/lib/resources/channels';
import { parseApiError } from '@/lib/form';
import { Alert, Button } from '@/components/ui';

/**
 * Shared "Connect with Meta" section used by the WhatsApp / Facebook /
 * Instagram connect dialogs. When the platform's Meta OAuth is configured it
 * becomes the primary path (one click, no IDs or tokens to copy) and the
 * manual credential form is tucked behind an "Advanced / manual setup"
 * toggle. When OAuth is NOT configured, the manual form stays front and
 * center with a muted note.
 */
export function MetaOauthConnect({
  provider,
  providerLabel,
  oauthAvailable,
  children,
}: {
  provider: MetaOauthProvider;
  providerLabel: string;
  oauthAvailable: boolean;
  /** The existing manual connect form. */
  children: React.ReactNode;
}) {
  const [manualOpen, setManualOpen] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState('');

  async function connectWithMeta() {
    setError('');
    setRedirecting(true);
    try {
      const { url } = await channelsApi.oauthStart(provider);
      // Full-page redirect to Meta's dialog; we come back to /dashboard/channels
      // with ?connected= or ?connect_error= handled by the channels page.
      window.location.href = url;
    } catch (err) {
      setError(parseApiError(err).message);
      setRedirecting(false);
    }
  }

  if (!oauthAvailable) {
    return (
      <div className="space-y-4">
        <p className="text-xs text-slate-400">
          One-click connect is available once Meta OAuth is configured for this
          deployment (see docs/META-OAUTH.md).
        </p>
        {children}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-semibold text-slate-900">
          Recommended: one-click connect
        </p>
        <p className="mt-1 text-xs text-slate-600">
          Sign in with Meta and choose your {providerLabel}. Tokens are fetched
          and stored encrypted, and webhooks are subscribed automatically — no
          IDs or secrets to copy.
        </p>
        <Button
          type="button"
          className="mt-3"
          loading={redirecting}
          onClick={() => void connectWithMeta()}
        >
          Connect with Meta
        </Button>
        {error && (
          <div className="mt-3">
            <Alert message={error} />
          </div>
        )}
      </div>

      <button
        type="button"
        className="text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-slate-700"
        onClick={() => setManualOpen((v) => !v)}
      >
        {manualOpen ? 'Hide advanced / manual setup' : 'Advanced / manual setup'}
      </button>

      {manualOpen && children}
    </div>
  );
}
