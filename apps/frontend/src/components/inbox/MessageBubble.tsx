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

export function MessageBubble({ message }: { message: Message }) {
  const outbound = message.direction === 'OUTBOUND';
  const isAI = message.senderType === 'AI';

  const senderName = outbound
    ? isAI
      ? `AI${message.senderUser ? ` · ${message.senderUser.fullName}` : ''}`
      : (message.senderUser?.fullName ?? 'Agent')
    : 'Customer';

  // Outbound agent: slate. Outbound AI: indigo (distinct but professional).
  // Inbound customer: light bordered.
  const bubbleClass = !outbound
    ? 'border border-slate-200 bg-white text-slate-800'
    : isAI
      ? 'border border-indigo-300 bg-indigo-50 text-indigo-900'
      : 'bg-slate-900 text-white';

  return (
    <div className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] sm:max-w-[75%] ${outbound ? 'items-end' : 'items-start'}`}>
        {isAI && (
          <div className="mb-0.5 flex justify-end">
            <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
              AI
            </span>
          </div>
        )}
        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-2 text-sm ${bubbleClass}`}
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
                  className="block"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- provider-hosted media URLs cannot go through next/image */}
                  <img
                    src={message.mediaUrl}
                    alt="Attached media"
                    className={`max-h-64 rounded-lg object-cover ${message.content ? 'mb-2' : ''}`}
                  />
                </a>
              )}
              {message.content}
            </>
          )}
        </div>
        <div
          className={`mt-1 flex gap-2 text-[11px] text-slate-400 ${
            outbound ? 'justify-end' : 'justify-start'
          }`}
        >
          <span>{senderName}</span>
          <span>·</span>
          <span>{fullTime(message.sentAt ?? message.createdAt)}</span>
          {outbound &&
            (() => {
              const label = deliveryLabel(message.status, message.delivery);
              return <span className={label.className}>· {label.text}</span>;
            })()}
        </div>
      </div>
    </div>
  );
}
