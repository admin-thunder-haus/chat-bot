'use client';

import { useEffect, useState } from 'react';
import { analyticsApi, type AnalyticsRange } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { channelLabel } from '@/lib/format';
import type { AIAnalytics } from '@/lib/types';
import { Alert, Badge, Button, PageHeader, Panel, Skeleton } from '@/components/ui';

const RANGES: AnalyticsRange[] = [7, 30, 90];

const REASON_LABELS: Record<string, string> = {
  customer_request: 'Customer asked for a human',
  low_confidence: 'AI could not answer',
  keyword: 'Keyword match',
};

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Panel>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
    </Panel>
  );
}

function percent(rate: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round(rate * 100)}%`;
}

function prettyLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

/** Simple named-count list panel with count badges. */
function CountList({
  title,
  items,
  empty = 'No data yet.',
}: {
  title: string;
  items: { key: string; label: string; count: number }[];
  empty?: string;
}) {
  return (
    <Panel>
      <p className="mb-3 text-sm font-semibold text-slate-900">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.key}
              className="flex items-center justify-between gap-3 text-sm text-slate-700"
            >
              <span className="min-w-0 truncate" title={item.label}>
                {item.label}
              </span>
              <Badge>{item.count}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Pure-CSS per-day bar chart: flex row of proportional-height bars. */
function VolumeChart({ byDay }: { byDay: { date: string; count: number }[] }) {
  const max = Math.max(...byDay.map((d) => d.count), 1);
  // Sparse date labels: aim for ~8 across the range.
  const labelEvery = Math.max(1, Math.ceil(byDay.length / 8));
  const total = byDay.reduce((sum, d) => sum + d.count, 0);

  return (
    <Panel>
      <p className="mb-3 text-sm font-semibold text-slate-900">
        Conversations per day
      </p>
      {total === 0 ? (
        <p className="text-sm text-slate-400">
          No conversations in this period.
        </p>
      ) : (
        <>
          <div className="flex h-32 items-end gap-px">
            {byDay.map((d) => (
              <div
                key={d.date}
                title={`${d.date}: ${d.count}`}
                className="flex flex-1 flex-col justify-end"
              >
                <div
                  className={`w-full rounded-t ${d.count > 0 ? 'bg-slate-900' : 'bg-slate-100'}`}
                  style={{
                    height: d.count > 0 ? `${Math.max((d.count / max) * 100, 4)}%` : '2px',
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-px text-[10px] text-slate-400">
            {byDay.map((d, i) => (
              <div key={d.date} className="flex-1 overflow-visible text-center">
                {i % labelEvery === 0 ? d.date.slice(5) : ''}
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

export default function AnalyticsPage() {
  const [days, setDays] = useState<AnalyticsRange>(7);
  const [data, setData] = useState<AIAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    analyticsApi
      .ai(days)
      .then((res) => active && setData(res))
      .catch((err) => active && setError(parseApiError(err).message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [days]);

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="How conversations and the AI assistant performed."
        actions={
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <Button
                key={r}
                size="sm"
                variant={days === r ? 'primary' : 'secondary'}
                onClick={() => setDays(r)}
              >
                {r} days
              </Button>
            ))}
          </div>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert message={error} />
        </div>
      )}

      {loading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Conversations" value={data.conversationVolume.total} />
            <StatCard
              label="AI success rate"
              value={percent(data.aiGenerations.successRate, data.aiGenerations.total)}
            />
            <StatCard
              label="Handoff rate"
              value={percent(data.handoff.rate, data.conversationVolume.total)}
            />
            <StatCard
              label="Auto replies sent"
              value={data.aiGenerations.autoRepliesSent}
            />
            <StatCard label="Resolved" value={data.resolution.resolvedInRange} />
            <StatCard
              label="Avg resolution"
              value={
                data.resolution.avgResolutionHours === null
                  ? '—'
                  : `${data.resolution.avgResolutionHours.toFixed(1)} h`
              }
            />
          </div>

          {/* Per-day volume */}
          <div className="mt-6">
            <VolumeChart byDay={data.conversationVolume.byDay} />
          </div>

          {/* Distributions */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <CountList
              title="By channel"
              items={data.conversationVolume.byChannel.map((c) => ({
                key: c.channelType,
                label: channelLabel(c.channelType),
                count: c.count,
              }))}
            />
            <CountList
              title="By status"
              items={data.resolution.byStatus.map((s) => ({
                key: s.status,
                label: prettyLabel(s.status),
                count: s.count,
              }))}
            />
            <CountList
              title="Handoff reasons"
              items={data.handoff.byReason.map((r) => ({
                key: r.reason,
                label: REASON_LABELS[r.reason] ?? prettyLabel(r.reason),
                count: r.count,
              }))}
              empty="No handoffs in this period."
            />
            <CountList
              title="AI generations by type"
              items={data.aiGenerations.byType.map((t) => ({
                key: t.type,
                label: prettyLabel(t.type),
                count: t.count,
              }))}
              empty="No AI activity in this period."
            />
          </div>

          {/* Top content */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <CountList
              title="Top FAQs"
              items={data.topFaqs.map((f) => ({
                key: f.id,
                label: f.question,
                count: f.count,
              }))}
              empty="No FAQs referenced yet."
            />
            <CountList
              title="Top services"
              items={data.topServices.map((s) => ({
                key: s.id,
                label: s.name,
                count: s.count,
              }))}
              empty="No services referenced yet."
            />
            <CountList
              title="Top products"
              items={data.topProducts.map((p) => ({
                key: p.id,
                label: p.name,
                count: p.count,
              }))}
              empty="No products referenced yet."
            />
            <CountList
              title="Top documents"
              items={data.topDocuments.map((d) => ({
                key: d.id,
                label: d.fileName,
                count: d.count,
              }))}
              empty="No documents referenced yet."
            />
          </div>

          {/* Languages */}
          <Panel className="mt-6">
            <p className="mb-3 text-sm font-semibold text-slate-900">
              Detected customer languages
            </p>
            {data.languages.length === 0 ? (
              <p className="text-sm text-slate-400">No languages detected yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.languages.map((l) => (
                  <Badge key={l.code} color="blue">
                    {l.code.toUpperCase()} · {l.count}
                  </Badge>
                ))}
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
