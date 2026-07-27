'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { channelsApi } from '@/lib/resources';
import { ApiClientError } from '@/lib/api';
import { parseApiError } from '@/lib/form';
import { useToast } from '@/components/toast';
import type { MetaOauthSelection } from '@/lib/resources/channels';
import { buildChoices, type Choice } from './choices';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  PageHeader,
  SectionCard,
  Skeleton,
} from '@/components/ui';

/**
 * Meta OAuth asset picker.
 *
 * Reached only when an authorization granted MORE THAN ONE connectable asset.
 * Nothing has been connected at this point — the backend parked the discovered
 * assets and sent the browser here rather than guessing which Page, Instagram
 * account, WhatsApp Business Account or number the operator meant.
 *
 * The selection is single-use and expires, so the two failure modes worth
 * designing for are "already used" and "too late". Both surface as the same
 * "no longer available" state with a route back to Channels to start again.
 */

/**
 * The backend answers 404 for every unusable selection — unknown id, another
 * tenant's id, already consumed, expired — deliberately indistinguishable, so
 * the id alone cannot be used to probe what exists. The UI collapses them all
 * into one honest "no longer available" state.
 */
function isUnusable(err: unknown): boolean {
  return err instanceof ApiClientError && err.status === 404;
}

const PROVIDER_LABEL: Record<string, string> = {
  facebook: 'Facebook Page',
  instagram: 'Instagram account',
  whatsapp: 'WhatsApp number',
};

function SelectAssetInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { notify } = useToast();
  const selectionId = params.get('selection') ?? '';

  const [selection, setSelection] = useState<MetaOauthSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [gone, setGone] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    if (!selectionId) {
      setGone(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await channelsApi.oauthSelection(selectionId);
      setSelection(res.selection);
    } catch (err) {
      if (isUnusable(err)) setGone(true);
      else setError(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [selectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const choices: Choice[] = selection ? buildChoices(selection) : [];

  async function connect() {
    const choice = choices.find((c) => c.key === chosen);
    if (!choice) return;
    setConnecting(true);
    try {
      await channelsApi.oauthConnectSelection(selectionId, choice.body);
      notify(`${choice.title} connected`, 'success');
      router.replace('/dashboard/channels?connected=1');
    } catch (err) {
      if (isUnusable(err)) setGone(true);
      else notify(parseApiError(err).message, 'error');
    } finally {
      setConnecting(false);
    }
  }

  const label = selection ? PROVIDER_LABEL[selection.provider] : 'account';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Choose what to connect"
        description={
          selection
            ? `This Meta authorization gave access to more than one ${label}. Pick the one to connect — nothing is connected until you confirm.`
            : 'Finishing the Meta connection.'
        }
      />

      {/* 1. Loading */}
      {loading && (
        <SectionCard title="Available accounts">
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </SectionCard>
      )}

      {/* 2. Error */}
      {!loading && error && (
        <div className="space-y-3">
          <Alert variant="error" message={error} />
          <Button variant="secondary" onClick={load}>
            Try again
          </Button>
        </div>
      )}

      {/* 3. Expired / already used / not yours */}
      {!loading && gone && (
        <SectionCard title="Connection request expired">
          <EmptyState
            title="This connection request is no longer available"
            description="It may have already been used, or it expired. Start the connection again from the Channels page — nothing was connected."
            action={
              <Button onClick={() => router.replace('/dashboard/channels')}>
                Back to Channels
              </Button>
            }
          />
        </SectionCard>
      )}

      {/* 4. The picker */}
      {!loading && !gone && !error && selection && (
        <>
          <SectionCard
            title="Available accounts"
            description={`${choices.length} available · you can connect the others later by running the connection again.`}
          >
            {choices.length === 0 ? (
              <EmptyState
                title="Nothing connectable was shared"
                description="The Meta authorization did not include an account this channel can use."
                action={
                  <Button onClick={() => router.replace('/dashboard/channels')}>
                    Back to Channels
                  </Button>
                }
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {choices.map((c) => {
                  const active = chosen === c.key;
                  return (
                    <li key={c.key}>
                      <label
                        className={`flex w-full cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                          active
                            ? 'border-slate-900 bg-slate-50'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="asset"
                          value={c.key}
                          checked={active}
                          onChange={() => setChosen(c.key)}
                          className="mt-1 h-4 w-4 shrink-0 accent-slate-900"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-900">
                            {c.title}
                          </span>
                          {c.subtitle && (
                            <span className="mt-0.5 block truncate text-xs text-slate-500">
                              {c.subtitle}
                            </span>
                          )}
                        </span>
                        {active && <Badge color="blue">Selected</Badge>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>

          {choices.length > 0 && (
            // Sticky, full-width primary action (§5) — the confirm step must
            // stay reachable on a phone without scrolling back up.
            <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                <Button
                  variant="secondary"
                  onClick={() => router.replace('/dashboard/channels')}
                  fullWidth
                >
                  Cancel
                </Button>
                <Button
                  onClick={connect}
                  disabled={!chosen}
                  loading={connecting}
                  loadingLabel="Connecting…"
                  fullWidth
                >
                  Connect selected
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function SelectAssetPage() {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <SelectAssetInner />
    </Suspense>
  );
}
