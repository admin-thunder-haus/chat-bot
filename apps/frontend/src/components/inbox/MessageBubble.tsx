'use client';

import { fullTime } from '@/lib/format';
import type { Message, MessageDelivery } from '@/lib/types';

/**
 * Lightweight delivery label + color for an outbound provider message. Prefers
 * the ChannelDelivery snapshot (transport truth) over the raw message status,
 * and surfaces a retry hint while a temporary failure is being re-attempted.
 */
function deliveryLabel(
  status: string,
  delivery: MessageDelivery | null | undefined,
): { text: string; className?: string } {
  if (delivery) {
    switch (delivery.status) {
      case 'QUEUED':
        return delivery.attemptCount > 0
          ? {
              text: `retrying (${delivery.attemptCount}/${delivery.maxAttempts})`,
              className: 'text-amber-500',
            }
          : { text: 'queued', className: 'text-slate-400' };
      case 'SENDING':
        return { text: 'sending', className: 'text-slate-400' };
      case 'DELIVERED':
        return { text: 'delivered', className: 'text-slate-400' };
      case 'READ':
        return { text: 'read', className: 'text-slate-400' };
      case 'EXPIRED':
        return { text: 'expired', className: 'text-red-500' };
      case 'FAILED':
        return { text: 'failed', className: 'text-red-500' };
      case 'SENT':
        return { text: 'sent', className: 'text-slate-400' };
      default:
        return { text: delivery.status.toLowerCase(), className: 'text-slate-400' };
    }
  }
  return {
    text: status.toLowerCase(),
    className: status === 'FAILED' ? 'text-red-500' : undefined,
  };
}

/** Short clock time for the meta line; the full timestamp lives in `title`. */
function clockTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function MessageBubble({ message }: { message: Message }) {
  const outbound = message.direction === 'OUTBOUND';
  const isAI = message.senderType === 'AI';
  const timestamp = message.sentAt ?? message.createdAt;

  // AI replies must be indistinguishable from an agent reply: customers (and
  // anyone shown a screenshot of the thread) should never be told which
  // outbound messages were machine-written. `senderType` stays 'AI' in the
  // database for analytics/audit — only the presentation is unified.
  const senderName = outbound
    ? (message.senderUser?.fullName ?? 'Agent')
    : 'Customer';

  // Outbound (agent or AI): slate. Inbound customer: light bordered.
  // The tail corner reinforces the direction so colour is not the only signal.
  const bubbleClass = !outbound
    ? 'rounded-bl-md border border-slate-200 bg-white text-slate-800'
    : 'rounded-br-md bg-brand-600 text-white';

  const delivery = outbound
    ? deliveryLabel(message.status, message.delivery)
    : null;

  return (
    <div className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`flex min-w-0 max-w-[85%] flex-col sm:max-w-[75%] ${
          outbound ? 'items-end' : 'items-start'
        }`}
      >
        <div
          className={`w-fit max-w-full overflow-hidden whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${bubbleClass}`}
        >
          {message.contentType === 'AUDIO' ? (
            <>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- transcript rendered below when available */}
              <audio
                controls
                src={message.mediaUrl ?? undefined}
                className="max-w-full"
              />
              {message.content ? (
                <p className="mt-1.5 text-xs italic opacity-80">
                  Transcript: {message.content}
                </p>
              ) : (
                <p className="mt-1.5 text-xs opacity-60">Voice message</p>
              )}
            </>
          ) : (
            <>
              {message.mediaUrl && (
                <a
                  href={message.mediaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- provider-hosted media URLs cannot go through next/image */}
                  <img
                    src={message.mediaUrl}
                    alt="Attached media"
                    className={`max-h-64 max-w-full rounded-lg object-cover ${message.content ? 'mb-2' : ''}`}
                  />
                </a>
              )}
              {message.content}
            </>
          )}
        </div>

        {/* Meta line: kept outside the bubble so timestamps never crowd the text. */}
        <div
          className={`mt-1 flex max-w-full flex-wrap items-center gap-x-1.5 px-1 text-[11px] text-slate-400 ${
            outbound ? 'justify-end' : 'justify-start'
          }`}
        >
          <span className="max-w-[10rem] truncate">{senderName}</span>
          <span aria-hidden="true">·</span>
          {/* Internal-only hint for staff: a neutral tooltip, never a badge or
              a different colour, so the thread reads as one human voice. */}
          <time
            dateTime={timestamp}
            title={
              isAI
                ? `${fullTime(timestamp)} — sent automatically by the assistant`
                : fullTime(timestamp)
            }
            className="tabular-nums"
          >
            {clockTime(timestamp)}
          </time>
          {delivery && (
            <>
              <span aria-hidden="true">·</span>
              <span className={delivery.className}>{delivery.text}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
