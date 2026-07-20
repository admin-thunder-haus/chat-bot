'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { canWrite } from '@/lib/permissions';
import { Alert, PageHeader, Panel, Spinner } from '@/components/ui';
import { AIPlaygroundForm } from '@/components/ai/AIPlaygroundForm';
import { AIPlaygroundResult } from '@/components/ai/AIPlaygroundResult';
import { AIUsageSummary } from '@/components/ai/AIUsageSummary';
import type { AIGenerationResult } from '@/lib/types';

export default function AIPlaygroundPage() {
  const { user } = useAuth();
  const [result, setResult] = useState<AIGenerationResult | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canWrite(user?.role)) {
    return (
      <div>
        <PageHeader title="AI Playground" />
        <Alert message="Only OWNER or ADMIN can access the AI Playground." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="AI Playground"
        description="Test how the assistant answers using your current company knowledge. Nothing is sent to customers."
      />

      <div className="mb-4">
        <Alert
          variant="warning"
          message="Answers use only your configured company data (services, FAQs, knowledge base, hours). Missing or outdated data affects results. AI can make mistakes."
        />
      </div>

      <div className="mb-6">
        <AIUsageSummary />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <AIPlaygroundForm onResult={setResult} onBusyChange={setBusy} />
        </Panel>

        <div>
          {busy ? (
            <Panel className="flex items-center justify-center py-16">
              <Spinner size={24} />
            </Panel>
          ) : result ? (
            <AIPlaygroundResult result={result} />
          ) : (
            <Panel className="py-16 text-center text-sm text-slate-400">
              Run a test question to see the AI response and its metadata.
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
