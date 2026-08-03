'use client';

import { useCallback, useEffect, useState } from 'react';
import { analyticsApi, type AnalyticsRange } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { channelLabel } from '@/lib/format';
import type { AIAnalytics } from '@/lib/types';
import {
  Alert,
  Badge,
  Button,
  PageHeader,
  SectionCard,
  Skeleton,
  StatCard,
} from '@/components/ui';

const RANGES: AnalyticsRange[] = [7, 30, 90];

const REASON_LABELS: Record<string, string> = {
  customer_request: 'Customer asked for a human',
  low_confidence: 'AI could not answer',
  keyword: 'Keyword match',
};

function percent(rate: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round(rate * 100)}%`;
}

/** `IN_PROGRESS` → `In progress` — never show a raw enum to a user (§8). */
function prettyLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

type CountItem = { key: string; label: string; count: number };

/** Named-count list with count badges — one card per distribution. */
function CountList({
  title,
  items,
  empty = 'No data yet.',
}: {
  title: string;
  items: CountItem[];
  empty?: string;
}) {
  return (
    <SectionCard title={title}>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
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
    </SectionCard>
  );
}

/**
 * Pure-CSS per-day bar chart. The bar track keeps a minimum bar width and
 * scrolls inside its own container, so a 90-day range never widens the page
 * on a phone (§5).
 */
function VolumeChart({ byDay }: { byDay: { date: string; count: number }[] }) {
  const max = Math.max(...byDay.map((d) => d.count), 1);
  // Sparse date labels: aim for ~6 across the range so they never collide.
  const labelEvery = Math.max(1, Math.ceil(byDay.length / 6));
  const total = byDay.reduce((sum, d) => sum + d.count, 0);

  return (
    <SectionCard
      title="Conversations per day"
      description={total > 0 ? `${total} in this period` : undefined}
    >
      {total === 0 ? (
        <p className="text-sm text-slate-500">
          No conversations in this period.
        </p>
      ) : (
        <div className="overflow-x-auto pb-1">
          <div className="flex h-32 min-w-full items-end gap-px">
            {byDay.map((d) => (
              <div
                key={d.date}
                title={`${d.date}: ${d.count}`}
                className="flex min-w-[5px] flex-1 flex-col justify-end"
              >
                <div
                  className={`w-full rounded-t ${
                    d.count > 0 ? 'bg-brand-600' : 'bg-slate-100'
                  }`}
                  style={{
                    height:
                      d.count > 0
                        ? `${Math.max((d.count / max) * 100, 4)}%`
                        : '2px',
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex min-w-full gap-px text-[10px] tabular-nums text-slate-400">
            {byDay.map((d, i) => (
              <div
                key={d.date}
                className="min-w-[5px] flex-1 whitespace-nowrap text-center"
              >
                {i % labelEvery === 0 ? d.date.slice(5) : ''}
              </div>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

export default function AnalyticsPage() {
  const [days, setDays] = useState<AnalyticsRange>(7);
  const [data, setData] = useState<AIAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await analyticsApi.ai(days));
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Analytics"
        description="How conversations and the AI assistant performed over the selected period."
        actions={
          <div
            role="group"
            aria-label="Reporting period"
            className="flex w-full gap-2 sm:w-auto"
          >
            {RANGES.map((r) => (
              <Button
                key={r}
                variant={days === r ? 'primary' : 'secondary'}
                aria-pressed={days === r}
                className="flex-1 sm:flex-none"
                onClick={() => setDays(r)}
              >
                {r} days
              </Button>
            ))}
          </div>
        }
      />

      <div className="space-y-6">
        {error && (
          <Alert>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{error} Nothing was loaded for this period.</span>
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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-[104px] rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-56 rounded-xl" />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-40 rounded-xl" />
              ))}
            </div>
          </>
        ) : !data ? null : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <StatCard
                label="Conversations"
                value={data.conversationVolume.total}
              />
              <StatCard
                label="AI success rate"
                value={percent(
                  data.aiGenerations.successRate,
                  data.aiGenerations.total,
                )}
                hint={`${data.aiGenerations.total} generations`}
              />
              <StatCard
                label="Handoff rate"
                value={percent(
                  data.handoff.rate,
                  data.conversationVolume.total,
                )}
                hint="Sent to a human"
              />
              <StatCard
                label="Auto replies sent"
                value={data.aiGenerations.autoRepliesSent}
              />
              <StatCard
                label="Resolved"
                value={data.resolution.resolvedInRange}
              />
              <StatCard
                label="Avg resolution"
                value={
                  data.resolution.avgResolutionHours === null
                    ? '—'
                    : `${data.resolution.avgResolutionHours.toFixed(1)} h`
                }
                hint="From first message to resolved"
              />
            </div>

            <VolumeChart byDay={data.conversationVolume.byDay} />

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

            <SectionCard
              title="Detected customer languages"
              description="Languages the assistant detected in inbound messages."
            >
              {data.languages.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No languages detected yet.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {data.languages.map((l) => (
                    <Badge key={l.code} color="blue">
                      {l.code.toUpperCase()} · {l.count}
                    </Badge>
                  ))}
                </div>
              )}
            </SectionCard>
          </>
        )}
      </div>
    </div>
  );
}
