'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { overviewApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import type { OverviewStats, UserRole } from '@/lib/types';
import {
  Alert,
  Badge,
  Button,
  PageHeader,
  SectionCard,
  Skeleton,
  StatCard,
} from '@/components/ui';

const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  AGENT: 'Agent',
};

export default function OverviewPage() {
  const { user, company } = useAuth();
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setStats(await overviewApi.get());
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
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Overview"
        description="A snapshot of the company knowledge your AI assistant answers from."
        actions={
          <Link href="/dashboard/ai-playground">
            <Button variant="secondary">Test the assistant</Button>
          </Link>
        }
      />

      <div className="space-y-6">
        {/* Identity — always known from the session, so it never has to load. */}
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Company"
            value={company?.displayName || company?.name || '—'}
          />
          <StatCard label="Signed in as" value={user?.fullName || '—'} />
          <StatCard
            label="Your role"
            value={
              user ? (
                <Badge color="blue">
                  {ROLE_LABELS[user.role] ?? user.role}
                </Badge>
              ) : (
                '—'
              )
            }
            hint="Roles control what you can change."
          />
        </div>

        {error && (
          <Alert>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{error} Your knowledge summary could not be loaded.</span>
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
        )}

        {loading ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[104px] rounded-xl" />
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-[104px] rounded-xl" />
              <Skeleton className="h-[104px] rounded-xl" />
            </div>
            <Skeleton className="h-24 rounded-xl" />
          </>
        ) : stats ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Services" value={stats.counts.services} />
              <StatCard
                label="Active services"
                value={stats.counts.activeServices}
                hint={`of ${stats.counts.services} total`}
              />
              <StatCard label="FAQs" value={stats.counts.faqs} />
              <StatCard
                label="Knowledge entries"
                value={stats.counts.knowledgeBaseEntries}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <StatCard
                label="Business hours"
                tone={stats.businessHoursComplete ? 'positive' : 'warning'}
                value={
                  stats.businessHoursComplete ? (
                    <Badge color="green">All 7 days set</Badge>
                  ) : (
                    <Badge color="amber">
                      {stats.counts.businessHoursConfiguredDays} of 7 days set
                    </Badge>
                  )
                }
                hint={
                  stats.businessHoursComplete
                    ? 'The assistant can tell customers when you are open.'
                    : 'Finish the week so the assistant can answer "are you open?".'
                }
              />
              <StatCard
                label="AI auto-reply"
                tone={stats.autoReplyEnabled ? 'positive' : 'neutral'}
                value={
                  stats.autoReplyEnabled ? (
                    <Badge color="green">Enabled</Badge>
                  ) : (
                    <Badge color="slate">Disabled</Badge>
                  )
                }
                hint="Change this on the AI settings page."
              />
            </div>

            <SectionCard
              title="Setup progress"
              description="Complete every step so the assistant has the full picture of your business."
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm tabular-nums text-slate-500">
                  {stats.setup.completedSteps} of {stats.setup.totalSteps} steps
                  done
                </p>
                <p className="text-sm font-medium tabular-nums text-slate-900">
                  {stats.setup.progressPercent}%
                </p>
              </div>
              <div
                className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200"
                role="progressbar"
                aria-valuenow={stats.setup.progressPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Setup progress"
              >
                <div
                  className="h-full rounded-full bg-brand-600 transition-all"
                  style={{ width: `${stats.setup.progressPercent}%` }}
                />
              </div>
            </SectionCard>
          </>
        ) : null}
      </div>
    </div>
  );
}
