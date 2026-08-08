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
 *
 * The disclosure is *controlled* by the owning dialog so its pinned modal
 * footer can show the matching actions (§5).
 */
export function MetaOauthConnect({
  provider,
  providerLabel,
  oauthAvailable,
  manualOpen,
  onManualOpenChange,
  primaryAction,
  children,
}: {
  provider: MetaOauthProvider;
  providerLabel: string;
  oauthAvailable: boolean;
  manualOpen: boolean;
  onManualOpenChange: (open: boolean) => void;
  /**
   * Replaces the default redirect button. WhatsApp needs it: its signup runs
   * inside Metas own JS-SDK popup, because a customer with no WhatsApp
   * Business Account has nothing to share on the plain consent screen.
   */
  primaryAction?: React.ReactNode;
  /** The existing manual connect form. */
  children: React.ReactNode;
}) {
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState('');
  // Instagram authorizes against Instagram itself, not Facebook — naming the
  // wrong company here makes an operator think they opened the wrong flow.
  const signInWith = provider === 'instagram' ? 'Instagram' : 'Meta';

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
        <p className="text-xs text-slate-500">
          One-click connect becomes available once Meta OAuth is configured for
          this deployment (see docs/META-OAUTH.md). Until then, use the manual
          setup below.
        </p>
        {children}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {primaryAction ?? (
      <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
        <p className="text-sm font-semibold text-slate-900">
          Recommended: one-click connect
        </p>
        <p className="mt-1 text-xs text-slate-600">
          Sign in with {signInWith} and choose your {providerLabel}. Tokens are
          fetched and stored encrypted, and webhooks are subscribed
          automatically — no IDs or secrets to copy.
        </p>
        <Button
          type="button"
          className="mt-3 w-full sm:w-auto"
          loading={redirecting}
          loadingLabel={`Opening ${signInWith}…`}
          onClick={() => void connectWithMeta()}
        >
          Connect with {signInWith}
        </Button>
        {error && (
          <div className="mt-3">
            <Alert message={error} />
          </div>
        )}
      </div>
      )}

      <button
        type="button"
        aria-expanded={manualOpen}
        className="min-h-10 text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        onClick={() => onManualOpenChange(!manualOpen)}
      >
        {manualOpen
          ? 'Hide advanced / manual setup'
          : 'Advanced / manual setup'}
      </button>

      {manualOpen && children}
    </div>
  );
}
