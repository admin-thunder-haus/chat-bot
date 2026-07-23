import type { BillingCycle } from '@prisma/client';
import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import { emitDomainEvent } from '../events/domain-events.service';
import { billingRepository } from './billing.repository';
import { ensureDefaultPlans } from './billing.plans';
import { expireIfOverdue } from './billing.expiry';
import {
  FREE_TRIAL_PLAN_CODE,
  serializePlan,
  readPlanLimits,
  type PlanView,
  type SubscriptionView,
  type SubscriptionWithPlan,
  type UsageSnapshot,
} from './billing.types';
import { isStripeConfigured, stripeProvider } from './stripe.provider';
import type { PaymentProvider } from './payment-provider.interface';

/**
 * Subscription lifecycle. Key behaviors:
 *
 * - Every company gets a TRIALING subscription on the free_trial plan, created
 *   at registration and (as a safety net) lazily on the first billing read.
 * - There is NO cron: overdue subscriptions become EXPIRED lazily inside
 *   getSubscription and every plan-limit check (see billing.expiry.ts).
 * - OFFLINE MODE: when no payment provider is configured (STRIPE_SECRET_KEY
 *   unset), plan changes apply immediately with a fresh billing period. When
 *   Stripe IS configured, changePlan returns a hosted checkout URL and the
 *   actual plan switch is applied by the Stripe webhook.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function getPaymentProvider(): PaymentProvider | null {
  return isStripeConfigured() ? stripeProvider : null;
}

function addPeriod(from: Date, cycle: BillingCycle): Date {
  const d = new Date(from);
  if (cycle === 'YEARLY') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

async function getFreeTrialPlan() {
  const existing = await billingRepository.findPlanByCode(FREE_TRIAL_PLAN_CODE);
  if (existing) return existing;
  // Fresh database (or tests): seed the catalog lazily.
  await ensureDefaultPlans();
  const seeded = await billingRepository.findPlanByCode(FREE_TRIAL_PLAN_CODE);
  if (!seeded) throw AppError.internal('Default plans are unavailable');
  return seeded;
}

async function getOrCreateSubscription(
  companyId: string,
): Promise<SubscriptionWithPlan> {
  const existing = await billingRepository.findSubscription(companyId);
  if (existing) return expireIfOverdue(existing);

  const plan = await getFreeTrialPlan();
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + env.BILLING_TRIAL_DAYS * DAY_MS);
  const created = await billingRepository.createSubscription({
    companyId,
    planId: plan.id,
    status: 'TRIALING',
    billingCycle: 'MONTHLY',
    trialEndsAt,
    currentPeriodStart: now,
    currentPeriodEnd: trialEndsAt,
  });
  return expireIfOverdue(created);
}

async function serializeSubscription(
  sub: SubscriptionWithPlan,
): Promise<SubscriptionView> {
  const counts = await billingRepository.usageCounts(sub.companyId);
  const limits = readPlanLimits(sub.plan.limits);
  const usage: UsageSnapshot = {
    channels: { used: counts.channels, limit: limits.maxChannels },
    users: { used: counts.users, limit: limits.maxUsers },
    aiRequestsThisMonth: {
      used: counts.aiRequestsThisMonth,
      limit: limits.maxAiRequestsPerMonth,
    },
    knowledgeDocuments: {
      used: counts.knowledgeDocuments,
      limit: limits.maxKnowledgeDocuments,
    },
    products: { used: counts.products, limit: limits.maxProducts },
    services: { used: counts.services, limit: limits.maxServices },
  };

  const daysLeftInTrial =
    sub.status === 'TRIALING' && sub.trialEndsAt
      ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - Date.now()) / DAY_MS))
      : null;

  return {
    plan: serializePlan(sub.plan),
    status: sub.status,
    billingCycle: sub.billingCycle,
    trialEndsAt: sub.trialEndsAt,
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    canceledAt: sub.canceledAt,
    daysLeftInTrial,
    usage,
  };
}

/** Apply a plan switch locally (offline mode + webhook-confirmed checkouts). */
async function applyPlanChange(
  sub: SubscriptionWithPlan,
  planId: string,
  cycle: BillingCycle,
  external?: {
    paymentProvider: string;
    externalCustomerId: string | null;
    externalSubscriptionId: string | null;
  },
): Promise<SubscriptionWithPlan> {
  const now = new Date();
  return billingRepository.updateSubscription(sub.id, {
    planId,
    status: 'ACTIVE',
    billingCycle: cycle,
    trialEndsAt: null,
    currentPeriodStart: now,
    currentPeriodEnd: addPeriod(now, cycle),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    ...(external ?? {}),
  });
}

/** Day 12: subscription domain event (OWNER notification + webhooks). Never throws. */
function emitSubscriptionEvent(
  companyId: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<void> {
  return emitDomainEvent({
    companyId,
    type: 'subscription.updated',
    title,
    body,
    data,
    notify: { type: 'SUBSCRIPTION_EVENT', emailRoles: ['OWNER'] },
  });
}

// Minimal shapes for the Stripe events this platform reacts to.
interface StripeEventObject {
  id?: string;
  customer?: string | null;
  subscription?: string | null;
  status?: string;
  cancel_at_period_end?: boolean;
  client_reference_id?: string | null;
  metadata?: Record<string, string>;
}

export interface StripeEvent {
  type?: string;
  data?: { object?: StripeEventObject };
}

export const billingService = {
  /**
   * Registration hook: start the free trial for a new company. Never throws —
   * billing must not block sign-up (the trial is also created lazily on the
   * first billing read).
   */
  async ensureTrialSubscription(companyId: string): Promise<void> {
    try {
      await getOrCreateSubscription(companyId);
    } catch (err) {
      logger.warn('billing.trialSubscription.failed', {
        companyId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },

  /** Current subscription (created lazily) + usage snapshot. */
  async getSubscription(companyId: string): Promise<SubscriptionView> {
    const sub = await getOrCreateSubscription(companyId);
    return serializeSubscription(sub);
  },

  /** Active plan catalog for the pricing page. */
  async listPlans(): Promise<PlanView[]> {
    let plans = await billingRepository.listActivePlans();
    if (plans.length === 0) {
      await ensureDefaultPlans();
      plans = await billingRepository.listActivePlans();
    }
    return plans.map(serializePlan);
  },

  /**
   * OWNER-only (enforced by the route): switch plans. Upgrades AND downgrades
   * apply immediately with a fresh billing period. With Stripe configured the
   * customer is sent to hosted checkout instead and the webhook applies the
   * switch after payment.
   */
  async changePlan(
    companyId: string,
    planCode: string,
    billingCycle: BillingCycle,
  ): Promise<
    { checkoutUrl: string } | { subscription: SubscriptionView }
  > {
    const plan = await billingRepository.findPlanByCode(planCode);
    if (!plan || !plan.isActive) {
      throw AppError.notFound('Plan not found');
    }
    if (plan.code === FREE_TRIAL_PLAN_CODE) {
      throw AppError.badRequest(
        'The free trial cannot be selected — every account starts on it automatically',
      );
    }

    const sub = await getOrCreateSubscription(companyId);

    const provider = getPaymentProvider();
    if (provider) {
      const checkout = await provider.createCheckout(companyId, plan, billingCycle);
      if (checkout) return { checkoutUrl: checkout.url };
      // Provider declined (misconfigured session, etc.) → offline fallback.
    }

    const updated = await applyPlanChange(sub, plan.id, billingCycle);
    logger.info('billing.plan.changed', {
      companyId,
      planCode: plan.code,
      billingCycle,
      offline: !provider,
    });
    await emitSubscriptionEvent(
      companyId,
      'Subscription plan changed',
      `Your subscription is now on the ${plan.name} plan (${billingCycle.toLowerCase()} billing)`,
      { planCode: plan.code, billingCycle, status: 'ACTIVE' },
    );
    return { subscription: await serializeSubscription(updated) };
  },

  /** Flag the subscription to end at the current period (not immediate). */
  async cancel(companyId: string): Promise<SubscriptionView> {
    const sub = await getOrCreateSubscription(companyId);
    if (sub.status === 'CANCELED' || sub.status === 'EXPIRED') {
      throw AppError.badRequest('This subscription is no longer active');
    }

    const provider = getPaymentProvider();
    if (provider && sub.externalSubscriptionId) {
      try {
        await provider.cancelExternal(sub);
      } catch (err) {
        // Local cancellation still proceeds; the provider can be reconciled.
        logger.warn('billing.cancelExternal.failed', {
          companyId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const updated = await billingRepository.updateSubscription(sub.id, {
      cancelAtPeriodEnd: true,
      canceledAt: new Date(),
    });
    await emitSubscriptionEvent(
      companyId,
      'Subscription cancellation scheduled',
      'Your subscription will end at the close of the current billing period',
      { cancelAtPeriodEnd: true, currentPeriodEnd: sub.currentPeriodEnd },
    );
    return serializeSubscription(updated);
  },

  /** Undo a pending cancellation before the period ends. */
  async resume(companyId: string): Promise<SubscriptionView> {
    const sub = await getOrCreateSubscription(companyId);
    if (sub.status === 'CANCELED' || sub.status === 'EXPIRED') {
      throw AppError.badRequest(
        'This subscription has ended — choose a plan to continue',
      );
    }
    const updated = await billingRepository.updateSubscription(sub.id, {
      cancelAtPeriodEnd: false,
      canceledAt: null,
    });
    await emitSubscriptionEvent(
      companyId,
      'Subscription resumed',
      'Your pending cancellation was undone — the subscription continues',
      { cancelAtPeriodEnd: false },
    );
    return serializeSubscription(updated);
  },

  /**
   * Minimal Stripe webhook handling: checkout completion applies the plan the
   * customer paid for; subscription updates map Stripe statuses onto ours.
   * Unknown event types are acknowledged and ignored.
   */
  async handleStripeWebhook(event: StripeEvent): Promise<{ handled: boolean }> {
    const type = event?.type ?? '';
    const obj = event?.data?.object ?? {};

    if (type === 'checkout.session.completed') {
      const companyId = obj.metadata?.companyId ?? obj.client_reference_id;
      const planCode = obj.metadata?.planCode;
      const cycle: BillingCycle =
        obj.metadata?.billingCycle === 'YEARLY' ? 'YEARLY' : 'MONTHLY';
      if (!companyId || !planCode) return { handled: false };

      const plan = await billingRepository.findPlanByCode(planCode);
      if (!plan) return { handled: false };
      const sub = await getOrCreateSubscription(companyId);
      await applyPlanChange(sub, plan.id, cycle, {
        paymentProvider: 'stripe',
        externalCustomerId: typeof obj.customer === 'string' ? obj.customer : null,
        externalSubscriptionId:
          typeof obj.subscription === 'string' ? obj.subscription : null,
      });
      logger.info('billing.webhook.checkoutCompleted', { companyId, planCode });
      await emitSubscriptionEvent(
        companyId,
        'Subscription plan changed',
        `Your payment was confirmed — the subscription is now on the ${plan.name} plan`,
        { planCode: plan.code, billingCycle: cycle, status: 'ACTIVE' },
      );
      return { handled: true };
    }

    if (
      type === 'customer.subscription.updated' ||
      type === 'customer.subscription.deleted'
    ) {
      if (!obj.id) return { handled: false };
      const sub = await billingRepository.findByExternalSubscriptionId(obj.id);
      if (!sub) return { handled: false };

      if (type === 'customer.subscription.deleted') {
        await billingRepository.updateSubscription(sub.id, {
          status: 'CANCELED',
          canceledAt: sub.canceledAt ?? new Date(),
        });
        await emitSubscriptionEvent(
          sub.companyId,
          'Subscription canceled',
          'Your subscription was canceled by the payment provider',
          { status: 'CANCELED' },
        );
        return { handled: true };
      }

      const mapped =
        obj.status === 'active'
          ? 'ACTIVE'
          : obj.status === 'past_due' || obj.status === 'unpaid'
            ? 'PAST_DUE'
            : obj.status === 'canceled'
              ? 'CANCELED'
              : null;
      if (!mapped) return { handled: false };
      await billingRepository.updateSubscription(sub.id, {
        status: mapped,
        cancelAtPeriodEnd: obj.cancel_at_period_end ?? sub.cancelAtPeriodEnd,
        ...(mapped === 'CANCELED' && !sub.canceledAt
          ? { canceledAt: new Date() }
          : {}),
      });
      if (mapped !== sub.status) {
        await emitSubscriptionEvent(
          sub.companyId,
          'Subscription status updated',
          `Your subscription status changed to ${mapped}`,
          { status: mapped, previousStatus: sub.status },
        );
      }
      return { handled: true };
    }

    return { handled: false };
  },
};
