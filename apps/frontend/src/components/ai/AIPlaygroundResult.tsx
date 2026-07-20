'use client';

import { Badge, Panel } from '@/components/ui';
import type { AIGenerationResult } from '@/lib/types';

export function AIPlaygroundResult({ result }: { result: AIGenerationResult }) {
  const c = result.contextSummary;
  return (
    <Panel className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge color="blue">Test result</Badge>
        {result.usedFallback && <Badge color="amber">General fallback</Badge>}
        {result.handoffRequested && <Badge color="red">Handoff suggested</Badge>}
        {c.injectionSuspected && <Badge color="red">Injection suspected</Badge>}
      </div>

      <div className="whitespace-pre-wrap break-words rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900">
        {result.text}
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-400">Model</dt>
          <dd className="font-medium">{result.model}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Tokens (in/out)</dt>
          <dd className="font-medium">
            {result.inputTokens ?? '—'}/{result.outputTokens ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Est. cost</dt>
          <dd className="font-medium">
            {result.estimatedCostUsd === null
              ? '—'
              : `$${result.estimatedCostUsd.toFixed(6)}`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Latency</dt>
          <dd className="font-medium">{result.latencyMs} ms</dd>
        </div>
      </dl>

      <div className="text-xs text-slate-500">
        Context sources used: {c.serviceIds.length} services · {c.faqIds.length}{' '}
        FAQs · {c.knowledgeIds.length} knowledge entries
        {c.businessHoursIncluded ? ' · business hours' : ''}
      </div>
      <p className="text-[11px] text-slate-400">
        This is a test only — no message was sent to any customer. Estimated cost
        is not the final invoice.
      </p>
    </Panel>
  );
}
