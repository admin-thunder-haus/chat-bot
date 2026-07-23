import { AppError } from '../../utils/AppError';
import { billingRepository } from './billing.repository';
import { expireIfOverdue } from './billing.expiry';
import {
  FREE_TRIAL_LIMITS,
  PLAN_LIMIT_LABELS,
  readPlanLimits,
  type PlanLimitKey,
  type PlanLimits,
  type SubscriptionWithPlan,
} from './billing.types';

/**
 * Plan-limit enforcement, wired into the feature seams (AI generation,
 * channel connect, knowledge-document upload, ...). Checks are lazy-expiring:
 * every call first flips an overdue subscription to EXPIRED (no cron needed).
 *
 * Companies WITHOUT a subscription row (legacy rows created before billing,
 * or raw test fixtures) are treated as unlimited — real tenants always get a
 * trial subscription at registration and on the first billing read.
 */

function effectiveLimits(sub: SubscriptionWithPlan): PlanLimits {
  // EXPIRED accounts (and canceled ones whose paid period ran out) fall back
  // to the free-trial limits rather than being locked out of the dashboard.
  const pastPeriod = sub.currentPeriodEnd.getTime() < Date.now();
  if (sub.status === 'EXPIRED' || (sub.status === 'CANCELED' && pastPeriod)) {
    return FREE_TRIAL_LIMITS;
  }
  return readPlanLimits(sub.plan.limits);
}

async function loadFreshSubscription(
  companyId: string,
): Promise<SubscriptionWithPlan | null> {
  const sub = await billingRepository.findSubscription(companyId);
  if (!sub) return null;
  return expireIfOverdue(sub);
}

export const billingLimitsService = {
  /**
   * Effective limits for a company, or null when it has no subscription yet
   * (in which case nothing is enforced).
   */
  async getLimits(companyId: string): Promise<PlanLimits | null> {
    const sub = await loadFreshSubscription(companyId);
    return sub ? effectiveLimits(sub) : null;
  },

  /**
   * Throw 403 PLAN_LIMIT_REACHED when `currentCount` has already used up the
   * plan's budget for `key`. A null limit means unlimited.
   */
  async assertWithinLimit(
    companyId: string,
    key: PlanLimitKey,
    currentCount: number,
  ): Promise<void> {
    const limits = await this.getLimits(companyId);
    if (!limits) return;
    const limit = limits[key];
    if (limit === null || currentCount < limit) return;
    throw AppError.forbidden(
      `Your plan allows up to ${limit} ${PLAN_LIMIT_LABELS[key]}. Upgrade your plan to add more.`,
      'PLAN_LIMIT_REACHED',
    );
  },

  /**
   * AI seam: an EXPIRED subscription blocks AI entirely; otherwise the plan's
   * monthly AI request cap applies (alongside the env-level usage limits the
   * AI usage service already enforces).
   */
  async assertAiRequestAllowed(companyId: string): Promise<void> {
    const sub = await loadFreshSubscription(companyId);
    if (!sub) return;

    if (sub.status === 'EXPIRED') {
      throw AppError.forbidden(
        'Your subscription has expired — AI replies are paused until you choose a plan',
        'SUBSCRIPTION_EXPIRED',
      );
    }

    const cap = effectiveLimits(sub).maxAiRequestsPerMonth;
    if (cap === null) return;
    const used = await billingRepository.monthlyAiRequestCount(companyId);
    if (used >= cap) {
      throw AppError.forbidden(
        `Your plan includes ${cap} AI replies per month and the limit has been reached. Upgrade your plan to continue.`,
        'PLAN_LIMIT_REACHED',
      );
    }
  },
};
