import { billingRepository } from './billing.repository';
import type { SubscriptionWithPlan } from './billing.types';

/**
 * Lazy subscription expiry. There is NO cron in this deployment: overdue
 * subscriptions are flipped to EXPIRED whenever billing state is read —
 * inside billingService.getSubscription and inside every plan-limit check —
 * which is exactly when the status matters.
 */

/** Grace period after a paid period ends before the account expires. */
export const SUBSCRIPTION_GRACE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/** True when the subscription should now be considered EXPIRED. */
export function isOverdue(
  sub: SubscriptionWithPlan,
  now: number = Date.now(),
): boolean {
  if (sub.status === 'TRIALING') {
    return sub.trialEndsAt !== null && sub.trialEndsAt.getTime() < now;
  }
  if (sub.status === 'ACTIVE') {
    return sub.currentPeriodEnd.getTime() + SUBSCRIPTION_GRACE_MS < now;
  }
  return false;
}

/** Flip an overdue subscription to EXPIRED; otherwise return it unchanged. */
export async function expireIfOverdue(
  sub: SubscriptionWithPlan,
): Promise<SubscriptionWithPlan> {
  if (!isOverdue(sub)) return sub;
  return billingRepository.updateSubscription(sub.id, { status: 'EXPIRED' });
}
