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

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-semibold text-slate-800">{value}</p>
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
      const { result } = await channelsApi.retryDelivery(account.id, deliveryId);
      notify(`Retry: ${result.status}`, result.status === 'failed' ? 'error' : 'success');
      await load();
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Diagnostics — ${account.displayName}`}>
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : error ? (
        <Alert message={error} />
      ) : data ? (
        <div className="space-y-5">
          {/* Health summary */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Badge color={scoreColor(data.health.healthScore)}>
                Health {data.health.healthScore}/100
              </Badge>
              <Badge color={data.health.connectionState === 'HEALTHY' ? 'green' : 'amber'}>
                {data.health.connectionState}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Success" value={data.health.successCount} />
              <Stat label="Failures" value={data.health.failureCount} />
              <Stat label="Consecutive" value={data.health.consecutiveFailures} />
              <Stat label="Retried" value={data.retryStats.retriedDeliveries} />
            </div>
            <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-slate-500 sm:grid-cols-2">
              <div>Last success: {fullTime(data.health.lastSuccessfulDeliveryAt)}</div>
              <div>Last failure: {fullTime(data.health.lastFailedDeliveryAt)}</div>
            </div>
          </div>

          {/* Delivery metrics */}
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Delivery metrics ({data.deliveryMetrics.total})
            </p>
            <div className="flex flex-wrap gap-1">
              {Object.entries(data.deliveryMetrics.byStatus).map(([status, count]) => (
                <span
                  key={status}
                  className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600"
                >
                  {status.toLowerCase()}: {count}
                </span>
              ))}
              {data.deliveryMetrics.total === 0 && (
                <span className="text-xs text-slate-400">No deliveries yet</span>
              )}
            </div>
          </div>

          {/* Retry stats */}
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Retry stats ({data.retryStats.totalAttempts} attempts)
            </p>
            <div className="flex flex-wrap gap-1">
              {Object.entries(data.retryStats.byOutcome).map(([outcome, count]) => (
                <span
                  key={outcome}
                  className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600"
                >
                  {outcome.toLowerCase()}: {count}
                </span>
              ))}
              {data.retryStats.totalAttempts === 0 && (
                <span className="text-xs text-slate-400">No attempts yet</span>
              )}
            </div>
          </div>

          {/* Recent failures */}
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Recent failures
            </p>
            {data.recentFailures.length === 0 ? (
              <p className="text-xs text-slate-400">None 🎉</p>
            ) : (
              <ul className="space-y-1">
                {data.recentFailures.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  >
                    <span className="min-w-0 truncate text-slate-600">
                      <span className="text-red-600">{f.status}</span>{' '}
                      {f.failureCode ?? f.failureType} · {f.attemptCount}/{f.maxAttempts} · {fullTime(f.updatedAt)}
                    </span>
                    {canManage && (
                      <Button
                        size="sm"
                        variant="secondary"
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
          </div>

          {/* Recent recoveries */}
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Recent recoveries
            </p>
            {data.recentRecoveries.length === 0 ? (
              <p className="text-xs text-slate-400">None</p>
            ) : (
              <ul className="space-y-1 text-xs text-slate-600">
                {data.recentRecoveries.map((r) => (
                  <li key={r.id}>
                    {r.activityType.replaceAll('_', ' ').toLowerCase()} · {fullTime(r.createdAt)}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Health history */}
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Health history
            </p>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200">
              {data.healthHistory.length === 0 ? (
                <p className="px-2 py-2 text-xs text-slate-400">No samples yet</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-xs">
                  {data.healthHistory.map((h) => (
                    <li key={h.id} className="flex items-center justify-between px-2 py-1.5">
                      <span className="text-slate-600">
                        <span className={h.healthy ? 'text-green-600' : 'text-amber-600'}>
                          {h.state}
                        </span>{' '}
                        · {h.checkType.toLowerCase()} · score {h.healthScore}
                      </span>
                      <span className="text-slate-400">{fullTime(h.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => void load()}>
              Refresh
            </Button>
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
