'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { canWrite } from '@/lib/permissions';
import {
  Alert,
  EmptyState,
  PageHeader,
  Panel,
  SectionCard,
  Skeleton,
} from '@/components/ui';
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
      <div className="mx-auto max-w-6xl">
        <PageHeader
          title="AI playground"
          description="Try the assistant against your own company knowledge."
        />
        <Alert
          variant="info"
          message="Only owners and admins can use the AI playground. Ask an owner if you need access."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="AI playground"
        description="Ask the assistant a test question and see exactly how it would answer. Nothing here is sent to customers."
      />

      <div className="space-y-6">
        <Alert
          variant="warning"
          message="Answers use only your configured company data — services, products, FAQs, knowledge base and hours. Missing or outdated data shows up here first, and the AI can still make mistakes."
        />

        <AIUsageSummary />

        <div className="grid gap-6 lg:grid-cols-2">
          <SectionCard
            title="Test question"
            description="Write what a customer might ask."
          >
            <AIPlaygroundForm onResult={setResult} onBusyChange={setBusy} />
          </SectionCard>

          <div>
            {busy ? (
              <Panel className="space-y-3" aria-busy="true">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </Panel>
            ) : result ? (
              <AIPlaygroundResult result={result} />
            ) : (
              <EmptyState
                title="No answer yet"
                description="Run a test question and the reply will appear here with the sources and settings it used."
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
