'use client';

import { useCallback, useEffect, useState } from 'react';
import { channelsApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { fullTime } from '@/lib/format';
import { useToast } from '@/components/toast';
import type { ChannelAccount, ChannelDiagnostics } from '@/lib/types';
import { Alert, Badge, Button, Modal, Skeleton } from '@/components/ui';

function scoreColor(score: number): 'green' | 'amber' | 'red' {
  if (score >= 70) return 'green';
  if (score >= 30) return 'amber';
  return 'red';
}

/** `AUTH_EXPIRED` → `Auth expired`; `delivered` → `Delivered` (§8). */
function humanize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className="text-sm font-semibold tabular-nums text-slate-800">
        {value}
      </p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
        {title}
      </p>
      {children}
    </div>
  );
}

export function ChannelDiagnosticsModal({
  account,
  canManage,
  onClose,
}: {
  account: ChannelAccount;
  canManage: boolean;
  onClose: () => void;
}) {
  const { notify } = useToast();
  const [data, setData] = useState<ChannelDiagnostics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await channelsApi.diagnostics(account.id));
      setError('');
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [account.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function retry(deliveryId: string) {
    setRetryingId(deliveryId);
    try {
      const { result } = await channelsApi.retryDelivery(
        account.id,
        deliveryId,
      );
      notify(
        `Retry ${humanize(result.status).toLowerCase()}`,
        result.status === 'failed' ? 'error' : 'success',
      );
      await load();
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Diagnostics — ${account.displayName}`}
      footer={
        <>
          <Button
            variant="secondary"
            loading={loading}
            loadingLabel="Refreshing…"
            onClick={() => void load()}
          >
            Refresh
          </Button>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      {loading ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <Alert>
          <div className="flex flex-col gap-2">
            <span>{error} Diagnostics could not be loaded.</span>
            <Button
              size="md"
              variant="secondary"
              className="self-start"
              onClick={() => void load()}
            >
              Try again
            </Button>
          </div>
        </Alert>
      ) : data ? (
        <div className="space-y-5">
          {/* Health summary */}
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge color={scoreColor(data.health.healthScore)}>
                Health score {data.health.healthScore}/100
              </Badge>
              <Badge
                color={
                  data.health.connectionState === 'HEALTHY' ? 'green' : 'amber'
                }
              >
                {humanize(data.health.connectionState)}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Delivered" value={data.health.successCount} />
              <Stat label="Failed" value={data.health.failureCount} />
              <Stat label="In a row" value={data.health.consecutiveFailures} />
              <Stat label="Retried" value={data.retryStats.retriedDeliveries} />
            </div>
            <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-slate-500 sm:grid-cols-2">
              <div>
                Last success:{' '}
                {fullTime(data.health.lastSuccessfulDeliveryAt) || 'Never'}
              </div>
              <div>
                Last failure:{' '}
                {fullTime(data.health.lastFailedDeliveryAt) || 'Never'}
              </div>
            </div>
          </div>

          <Section title={`Deliveries (${data.deliveryMetrics.total})`}>
            <div className="flex flex-wrap gap-1">
              {Object.entries(data.deliveryMetrics.byStatus).map(
                ([status, count]) => (
                  <span
                    key={status}
                    className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-600"
                  >
                    {humanize(status)}: {count}
                  </span>
                ),
              )}
              {data.deliveryMetrics.total === 0 && (
                <span className="text-xs text-slate-500">
                  No deliveries yet
                </span>
              )}
            </div>
          </Section>

          <Section
            title={`Retries (${data.retryStats.totalAttempts} attempts)`}
          >
            <div className="flex flex-wrap gap-1">
              {Object.entries(data.retryStats.byOutcome).map(
                ([outcome, count]) => (
                  <span
                    key={outcome}
                    className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-600"
                  >
                    {humanize(outcome)}: {count}
                  </span>
                ),
              )}
              {data.retryStats.totalAttempts === 0 && (
                <span className="text-xs text-slate-500">No attempts yet</span>
              )}
            </div>
          </Section>

          <Section title="Recent failures">
            {data.recentFailures.length === 0 ? (
              <p className="text-xs text-slate-500">
                None — every recent message went through.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.recentFailures.map((f) => (
                  <li
                    key={f.id}
                    className="flex flex-col gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="min-w-0 break-words text-slate-600">
                      <span className="font-medium text-red-600">
                        {humanize(f.status)}
                      </span>{' '}
                      · {humanize(f.failureCode ?? f.failureType)} · attempt{' '}
                      {f.attemptCount}/{f.maxAttempts} · {fullTime(f.updatedAt)}
                    </span>
                    {canManage && (
                      <Button
                        size="md"
                        variant="secondary"
                        className="sm:shrink-0"
                        loading={retryingId === f.id}
                        onClick={() => void retry(f.id)}
                      >
                        Retry
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Recent recoveries">
            {data.recentRecoveries.length === 0 ? (
              <p className="text-xs text-slate-500">None recorded.</p>
            ) : (
              <ul className="space-y-1 text-xs text-slate-600">
                {data.recentRecoveries.map((r) => (
                  <li key={r.id} className="break-words">
                    {humanize(r.activityType)} · {fullTime(r.createdAt)}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Health history">
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200">
              {data.healthHistory.length === 0 ? (
                <p className="px-3 py-2 text-xs text-slate-500">
                  No samples yet — run a health check to take one.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 text-xs">
                  {data.healthHistory.map((h) => (
                    <li
                      key={h.id}
                      className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="text-slate-600">
                        <span
                          className={
                            h.healthy ? 'text-green-700' : 'text-amber-700'
                          }
                        >
                          {humanize(h.state)}
                        </span>{' '}
                        · {humanize(h.checkType)} · score{' '}
                        <span className="tabular-nums">{h.healthScore}</span>
                      </span>
                      <span className="text-slate-400">
                        {fullTime(h.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>
        </div>
      ) : null}
    </Modal>
  );
}
