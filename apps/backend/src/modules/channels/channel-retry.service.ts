import { env } from '../../config/env';
import type { ChannelDeliveryFailureType } from '@prisma/client';

/**
 * Retry policy for the delivery engine. Pure, deterministic-ish math (jitter
 * aside) so it is trivially testable and provider-independent. No queue, no
 * worker — this only computes *when* and *whether* a delivery may be retried;
 * executing the retry is the delivery engine's job (and, later, a Part 3 worker).
 */
export interface RetryPolicy {
  maxAttempts: number;
  baseMs: number;
  factor: number;
  maxMs: number;
  jitter: number;
  ttlMs: number;
}

export function getRetryPolicy(): RetryPolicy {
  return {
    maxAttempts: env.CHANNEL_DELIVERY_MAX_ATTEMPTS,
    baseMs: env.CHANNEL_DELIVERY_BACKOFF_BASE_MS,
    factor: env.CHANNEL_DELIVERY_BACKOFF_FACTOR,
    maxMs: env.CHANNEL_DELIVERY_BACKOFF_MAX_MS,
    jitter: env.CHANNEL_DELIVERY_BACKOFF_JITTER,
    ttlMs: env.CHANNEL_DELIVERY_TTL_MS,
  };
}

export const channelRetryService = {
  policy: getRetryPolicy,

  /**
   * Exponential backoff in ms for the delay BEFORE the given attempt number.
   * `attemptNumber` is 1-based (attempt 1 = the first retry after a failure).
   * `withJitter=false` yields the deterministic base curve (used in tests).
   */
  backoffMs(attemptNumber: number, withJitter = true): number {
    const p = getRetryPolicy();
    const exp = Math.max(0, attemptNumber - 1);
    const raw = p.baseMs * Math.pow(p.factor, exp);
    const capped = Math.min(raw, p.maxMs);
    if (!withJitter || p.jitter <= 0) return Math.round(capped);
    // Proportional +/- jitter so retries don't thundering-herd.
    const delta = capped * p.jitter;
    const jittered = capped - delta + Math.random() * (2 * delta);
    return Math.max(0, Math.round(jittered));
  },

  /** When the next attempt should run, given the attempts already made. */
  nextAttemptAt(attemptsMade: number, from: Date): Date {
    return new Date(from.getTime() + this.backoffMs(attemptsMade));
  },

  /**
   * Whether another attempt is allowed. Permanent failures are never retried;
   * temporary failures are retried until `maxAttempts` is reached.
   */
  isRetryable(
    failureType: ChannelDeliveryFailureType,
    attemptCount: number,
    maxAttempts: number,
  ): boolean {
    if (failureType === 'PERMANENT') return false;
    if (failureType === 'NONE') return false;
    return attemptCount < maxAttempts;
  },

  /** TTL expiry instant for a delivery requested at `requestedAt`. */
  expiresAt(requestedAt: Date): Date {
    return new Date(requestedAt.getTime() + getRetryPolicy().ttlMs);
  },
};
