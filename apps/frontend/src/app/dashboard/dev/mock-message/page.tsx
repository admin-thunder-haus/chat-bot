'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PageHeader, Panel, Alert } from '@/components/ui';
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
      <div>
        <PageHeader title="Mock inbound message" />
        <Alert message="This developer tool is not available in production." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Mock inbound message"
        description="Simulate a customer message from a channel (development only). This will be replaced by real channel webhooks later."
      />

      <div className="mb-4">
        <Alert
          variant="warning"
          message="Development tool: real WhatsApp/Instagram/Facebook/Telegram channels are not connected yet."
        />
      </div>

      <Panel>
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
      </Panel>

      {last && (
        <Panel className="mt-4">
          <p className="text-sm text-slate-700">
            {last.idempotent
              ? 'This external message was already processed.'
              : 'Created an inbound message.'}{' '}
            <Link
              href={`/dashboard/inbox?conversationId=${last.conversation.id}`}
              className="font-medium text-slate-900 underline"
            >
              Open the conversation in the Inbox →
            </Link>
          </p>
        </Panel>
      )}
    </div>
  );
}
