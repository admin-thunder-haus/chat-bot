'use client';

import { useCallback, useEffect, useState } from 'react';
import { loginHistoryApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { fullTime, relativeTime } from '@/lib/format';
import type { LoginAuditOutcome, LoginHistoryEntry } from '@/lib/types';
import {
  Alert,
  Badge,
  Button,
  DataList,
  EmptyState,
  SectionCard,
  Skeleton,
  type DataListColumn,
} from '@/components/ui';

/**
 * The user's own recent sign-in attempts — a trust signal, not a security
 * control. It sits on the profile page because that is where a user already
 * goes to check "is my account mine?", and it is a separate component (rather
 * than more state inside ProfilePage) so its four data states are independent
 * of the company form's: a failed history fetch must not blank out the form.
 */

/**
 * Plain language for each outcome (§8 — an enum is never rendered raw), plus
 * the colour that only ever REINFORCES the word (§3, never colour alone).
 * UNKNOWN_EMAIL cannot appear in a user's own history (such a row has no user),
 * but it is mapped anyway so the union stays exhaustive if that ever changes.
 */
const OUTCOMES: Record<
  LoginAuditOutcome,
  { label: string; color: 'green' | 'red' | 'amber' | 'slate' }
> = {
  SUCCESS: { label: 'Signed in', color: 'green' },
  INVALID_PASSWORD: { label: 'Wrong password', color: 'red' },
  UNKNOWN_EMAIL: { label: 'Email not recognised', color: 'red' },
  ACCOUNT_DISABLED: { label: 'Account disabled', color: 'amber' },
  EMAIL_NOT_VERIFIED: { label: 'Email not verified', color: 'amber' },
  COMPANY_SUSPENDED: { label: 'Company suspended', color: 'amber' },
};

function outcomeOf(outcome: LoginAuditOutcome) {
  // Fall back rather than crash if the backend adds an outcome first: the label
  // is still readable, just not yet copy-edited.
  return OUTCOMES[outcome] ?? { label: 'Unknown result', color: 'slate' };
}

const COLUMNS: DataListColumn<LoginHistoryEntry>[] = [
  {
    key: 'when',
    header: 'When',
    primary: true,
    // Absolute time leads because an audit trail is only useful if you can say
    // "that was Tuesday at 3"; the compact relative form is the quick scan.
    cell: (e) => (
      <span className="block">
        <span className="block tabular-nums text-slate-900">
          {fullTime(e.createdAt)}
        </span>
        <span className="block text-xs tabular-nums text-slate-500">
          {relativeTime(e.createdAt)}
        </span>
      </span>
    ),
  },
  {
    key: 'outcome',
    header: 'Result',
    cell: (e) => {
      const { label, color } = outcomeOf(e.outcome);
      return <Badge color={color}>{label}</Badge>;
    },
  },
  {
    key: 'ip',
    header: 'IP address',
    cell: (e) => (
      <span className="tabular-nums break-words">{e.ipAddress ?? '—'}</span>
    ),
  },
  {
    key: 'device',
    header: 'Device',
    // Dropped from the phone cards: a user-agent string is long, low-value at
    // a glance, and the exact text is one tap away on desktop.
    hideOnMobile: true,
    cell: (e) => (
      <span className="block max-w-xs truncate" title={e.userAgent ?? ''}>
        {e.userAgent ?? '—'}
      </span>
    ),
  },
];

export function LoginHistorySection() {
  const [events, setEvents] = useState<LoginHistoryEntry[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { events: rows } = await loginHistoryApi.list();
      setEvents(rows);
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SectionCard
      title="Recent sign-in activity"
      description="The latest attempts to sign in to your account, successful or not. Something you do not recognise? Change your password."
    >
      {loading ? (
        // Shaped like the list it replaces, so nothing jumps when it arrives.
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
        </div>
      ) : error ? (
        <Alert>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>{error} Your sign-in history could not be loaded.</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void load()}
              className="sm:shrink-0"
            >
              Try again
            </Button>
          </div>
        </Alert>
      ) : events && events.length === 0 ? (
        <EmptyState
          title="No sign-ins recorded yet"
          description="Every sign-in attempt on your account will be listed here, with the time, IP address and device it came from."
        />
      ) : (
        <DataList<LoginHistoryEntry>
          bare
          items={events ?? []}
          keyOf={(e) => e.id}
          columns={COLUMNS}
          caption="Recent sign-in attempts on your account"
        />
      )}
    </SectionCard>
  );
}
