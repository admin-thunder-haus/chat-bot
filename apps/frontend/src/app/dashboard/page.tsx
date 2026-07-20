'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { overviewApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import type { OverviewStats } from '@/lib/types';
import { Alert, Badge, PageHeader, Panel, Skeleton } from '@/components/ui';

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Panel>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
    </Panel>
  );
}

export default function OverviewPage() {
  const { user, company } = useAuth();
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    overviewApi
      .get()
      .then((data) => active && setStats(data))
      .catch((err) => active && setError(parseApiError(err).message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div>
      <PageHeader
        title="Overview"
        description="A snapshot of the information your future AI assistant will use."
      />

      {error && <Alert message={error} />}

      {/* Identity */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Company" value={company?.displayName || company?.name || '—'} />
        <StatCard label="Current user" value={user?.fullName || '—'} />
        <Panel>
          <p className="text-xs uppercase tracking-wide text-slate-400">Role</p>
          <p className="mt-2">
            <Badge color="blue">{user?.role}</Badge>
          </p>
        </Panel>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : stats ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Services" value={stats.counts.services} />
            <StatCard label="Active services" value={stats.counts.activeServices} />
            <StatCard label="FAQs" value={stats.counts.faqs} />
            <StatCard
              label="Knowledge base"
              value={stats.counts.knowledgeBaseEntries}
            />
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Panel>
              <p className="text-xs uppercase tracking-wide text-slate-400">
                Business hours
              </p>
              <p className="mt-2 flex items-center gap-2">
                {stats.businessHoursComplete ? (
                  <Badge color="green">All 7 days configured</Badge>
                ) : (
                  <Badge color="amber">
                    {stats.counts.businessHoursConfiguredDays}/7 days configured
                  </Badge>
                )}
              </p>
            </Panel>
            <Panel>
              <p className="text-xs uppercase tracking-wide text-slate-400">
                AI auto-reply
              </p>
              <p className="mt-2">
                {stats.autoReplyEnabled ? (
                  <Badge color="green">Enabled (not yet active)</Badge>
                ) : (
                  <Badge color="slate">Disabled</Badge>
                )}
              </p>
            </Panel>
          </div>

          {/* Setup progress */}
          <Panel className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-slate-800">Setup progress</p>
              <span className="text-sm text-slate-500">
                {stats.setup.progressPercent}% ({stats.setup.completedSteps}/
                {stats.setup.totalSteps})
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-slate-900 transition-all"
                style={{ width: `${stats.setup.progressPercent}%` }}
              />
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  );
}
