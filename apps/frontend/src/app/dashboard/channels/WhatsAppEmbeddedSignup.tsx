'use client';

import { useEffect, useRef, useState } from 'react';
import { channelsApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { Alert, Button } from '@/components/ui';

/**
 * WhatsApp Embedded Signup — the real one.
 *
 * WhatsApp is the only channel where the customer cannot simply share
 * something they already own. A WhatsApp Business Account and a registered
 * phone number have to be CREATED, and Meta only runs that wizard inside its
 * own JS-SDK popup. Sending the browser to the plain OAuth dialog instead — as
 * this used to — shows a consent screen listing assets to share, which is
 * empty for anyone who has not onboarded WhatsApp before, and returns a token
 * granting no WABA at all. The failure reads as "No WhatsApp Business Account
 * was shared during signup" and gives the operator nothing to act on.
 *
 * The popup hands back two things by two different routes: a `code` through the
 * FB.login callback, and the ids the customer picked through a `message` event.
 * Both are forwarded; the backend re-checks the ids against the grant, so a
 * spoofed postMessage cannot connect an account the authorization never
 * covered.
 */

interface FbLoginResponse {
  authResponse?: { code?: string } | null;
}

interface FacebookSdk {
  init(options: {
    appId: string;
    cookie?: boolean;
    xfbml?: boolean;
    version: string;
  }): void;
  login(
    cb: (response: FbLoginResponse) => void,
    options: Record<string, unknown>,
  ): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_SRC = 'https://connect.facebook.net/en_US/sdk.js';
const GRAPH_VERSION = 'v21.0';

/** Load the SDK once per page, reusing it across opens of the dialog. */
function loadFacebookSdk(appId: string): Promise<FacebookSdk> {
  return new Promise((resolve, reject) => {
    if (window.FB) {
      resolve(window.FB);
      return;
    }
    const existing = document.getElementById('facebook-jssdk');
    const finish = (): void => {
      if (!window.FB) {
        reject(new Error('Facebook SDK loaded but unavailable'));
        return;
      }
      window.FB.init({
        appId,
        cookie: true,
        xfbml: false,
        version: GRAPH_VERSION,
      });
      resolve(window.FB);
    };
    if (existing) {
      existing.addEventListener('load', finish);
      existing.addEventListener('error', () => reject(new Error('sdk')));
      return;
    }
    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = SDK_SRC;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = finish;
    script.onerror = () => reject(new Error('Could not load the Meta SDK'));
    document.body.appendChild(script);
  });
}

export function WhatsAppEmbeddedSignup({
  appId,
  configId,
  onConnected,
}: {
  appId: string;
  configId: string;
  onConnected: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The ids arrive on a separate channel from the code and usually earlier, so
  // they are held in a ref rather than state — a re-render must not lose them.
  const picked = useRef<{ phoneNumberId?: string; wabaId?: string }>({});

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Only Meta's own frame may set these ids.
      if (!/^https:\/\/www\.facebook\.com$/.test(event.origin)) return;
      try {
        const data = JSON.parse(event.data as string) as {
          type?: string;
          event?: string;
          data?: { phone_number_id?: string; waba_id?: string };
        };
        if (data.type !== 'WA_EMBEDDED_SIGNUP') return;
        if (data.data?.phone_number_id) {
          picked.current.phoneNumberId = data.data.phone_number_id;
        }
        if (data.data?.waba_id) picked.current.wabaId = data.data.waba_id;
      } catch {
        // Non-JSON chatter from other embeds — ignore.
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  async function start() {
    setError('');
    setBusy(true);
    picked.current = {};
    try {
      const FB = await loadFacebookSdk(appId);
      const code = await new Promise<string>((resolve, reject) => {
        FB.login(
          (response) => {
            const c = response?.authResponse?.code;
            if (c) resolve(c);
            else reject(new Error('CANCELLED'));
          },
          {
            config_id: configId,
            response_type: 'code',
            // Without this the SDK returns an access token instead of a code,
            // and the backend has nothing to exchange.
            override_default_response_type: true,
            extras: {
              // `setup: {}` is what turns the consent screen into the signup
              // wizard: create the business account, add the number, verify it.
              setup: {},
              featureType: '',
              sessionInfoVersion: '3',
            },
          },
        );
      });

      await channelsApi.oauthCompleteWhatsApp({
        code,
        phoneNumberId: picked.current.phoneNumberId,
        wabaId: picked.current.wabaId,
      });
      onConnected();
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'CANCELLED'
          ? 'The WhatsApp setup window was closed before it finished.'
          : parseApiError(err).message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
      <p className="text-sm font-semibold text-slate-900">
        Recommended: connect with Meta
      </p>
      <p className="mt-1 text-xs text-slate-600">
        Meta opens a window where you add the phone number that should receive
        your messages, verify it with a code, and finish. Tokens are stored
        encrypted and webhooks are wired up automatically.
      </p>
      <Button
        type="button"
        className="mt-3 w-full sm:w-auto"
        loading={busy}
        loadingLabel="Waiting for Meta…"
        onClick={() => void start()}
      >
        Connect with Meta
      </Button>
      <p className="mt-3 text-xs text-slate-500">
        Use a number that is <strong>not</strong> currently on WhatsApp — once
        it is connected to the API it stops working in the WhatsApp phone app.
      </p>
      {error && (
        <div className="mt-3">
          <Alert message={error} />
        </div>
      )}
    </div>
  );
}
