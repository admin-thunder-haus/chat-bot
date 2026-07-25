'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, PageHeader, SectionCard } from '@/components/ui';
import { MockInboundForm } from '@/components/inbox/MockInboundForm';
import { useToast } from '@/components/toast';
import type { MockInboundResult } from '@/lib/resources';

// Development-only tool. Hidden entirely in production builds.
const isProd = process.env.NODE_ENV === 'production';

export default function MockMessagePage() {
  const { notify } = useToast();
  const [last, setLast] = useState<MockInboundResult | null>(null);

  if (isProd) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Mock inbound message"
          description="A development-only tool for simulating customer messages."
        />
        <Alert message="This developer tool is not available in production." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Mock inbound message"
        description="Simulate a customer message arriving on a channel, without any external service."
      />

      <div className="space-y-6">
        <Alert
          variant="warning"
          message="Development tool. Messages created here behave like real inbound messages, so AI auto-reply may respond to them."
        />

        <SectionCard
          title="Message details"
          description="Pick a channel and write what the customer would say."
        >
          <MockInboundForm
            onSuccess={(result) => {
              setLast(result);
              notify(
                result.idempotent
                  ? 'Duplicate message ignored (idempotent)'
                  : 'Mock inbound message created',
                'success',
              );
            }}
          />
        </SectionCard>

        {last && (
          <Alert variant="success">
            <span>
              {last.idempotent
                ? 'This external message had already been processed.'
                : 'Inbound message created.'}{' '}
              <Link
                href={`/dashboard/inbox?conversationId=${last.conversation.id}`}
                className="font-medium underline"
              >
                Open the conversation in the inbox
              </Link>
            </span>
          </Alert>
        )}
      </div>
    </div>
  );
}
