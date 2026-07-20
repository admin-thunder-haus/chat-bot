'use client';

import { useEffect, useState } from 'react';
import { aiApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import type { AIUsageSummary as Summary } from '@/lib/types';
import { Badge, Panel, Skeleton } from '@/components/ui';

/** Compact company AI usage summary (today + month + limits). */
export function AIUsageSummary() {
  const [usage, setUsage] = useState<Summary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    aiApi
      .usage()
      .then((u) => active && setUsage(u))
      .catch((err) => active && setError(parseApiError(err).message));
    return () => {
      active = false;
    };
  }, []);

  if (error) return <Panel className="text-sm text-red-600">{error}</Panel>;
  if (!usage) return <Skeleton className="h-24" />;

  return (
    <Panel>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-800">AI usage</p>
        {usage.withinQuota ? (
          <Badge color="green">Within quota</Badge>
        ) : (
          <Badge color="red">Quota reached</Badge>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-400">Requests today</dt>
          <dd className="font-medium">
            {usage.today.requestCount}/{usage.limits.dailyRequestLimit}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Tokens today</dt>
          <dd className="font-medium">{usage.today.totalTokenCount}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Est. cost today</dt>
          <dd className="font-medium">${usage.today.estimatedCostUsd}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Tokens this month</dt>
          <dd className="font-medium">
            {usage.month.totalTokenCount}/{usage.limits.monthlyTokenLimit}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-[11px] text-slate-400">
        Cost is an estimate based on published model pricing — not the final invoice.
      </p>
    </Panel>
  );
}
