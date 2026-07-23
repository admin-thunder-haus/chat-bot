import type { Plan, Prisma, SubscriptionStatus, BillingCycle } from '@prisma/client';

/**
 * Billing domain types + the default plan catalog.
 *
 * This module is intentionally dependency-free (type-only imports) so it can
 * be consumed by prisma/seed.ts without pulling in config/env side effects.
 */

/** Per-plan usage caps. `null` means unlimited. */
export interface PlanLimits {
  maxChannels: number | null;
  maxUsers: number | null;
  maxAiRequestsPerMonth: number | null;
  maxKnowledgeDocuments: number | null;
  maxProducts: number | null;
  maxServices: number | null;
}

export type PlanLimitKey = keyof PlanLimits;

/** Human-readable labels used in limit-reached error messages. */
export const PLAN_LIMIT_LABELS: Record<PlanLimitKey, string> = {
  maxChannels: 'connected channels',
  maxUsers: 'team members',
  maxAiRequestsPerMonth: 'AI requests this month',
  maxKnowledgeDocuments: 'knowledge documents',
  maxProducts: 'products',
  maxServices: 'services',
};

export const FREE_TRIAL_PLAN_CODE = 'free_trial';

export interface DefaultPlanDefinition {
  code: string;
  name: string;
  description: string;
  /** Decimal strings to avoid float drift; Prisma accepts them directly. */
  monthlyPriceUsd: string;
  yearlyPriceUsd: string;
  limits: PlanLimits;
  features: string[];
  sortOrder: number;
}

/**
 * The default plan catalog. Upserted idempotently by `ensureDefaultPlans()`
 * (server boot + lazily) and by prisma/seed.ts. Editing a plan here changes
 * it in the DB on the next boot (upsert by unique `code`).
 */
export const DEFAULT_PLANS: DefaultPlanDefinition[] = [
  {
    code: FREE_TRIAL_PLAN_CODE,
    name: 'Free Trial',
    description: 'Try the full platform free for 14 days.',
    monthlyPriceUsd: '0.00',
    yearlyPriceUsd: '0.00',
    limits: {
      maxChannels: 1,
      maxUsers: 2,
      maxAiRequestsPerMonth: 200,
      maxKnowledgeDocuments: 2,
      maxProducts: 25,
      maxServices: 25,
    },
    features: [
      '1 connected channel',
      '2 team members',
      '200 AI replies / month',
      '2 knowledge documents',
      '14-day trial',
    ],
    sortOrder: 0,
  },
  {
    code: 'starter',
    name: 'Starter',
    description: 'For small teams getting started with AI support.',
    monthlyPriceUsd: '19.00',
    yearlyPriceUsd: '190.00',
    limits: {
      maxChannels: 2,
      maxUsers: 5,
      maxAiRequestsPerMonth: 1000,
      maxKnowledgeDocuments: 5,
      maxProducts: 100,
      maxServices: 100,
    },
    features: [
      '2 connected channels',
      '5 team members',
      '1,000 AI replies / month',
      '5 knowledge documents',
      'Email support',
    ],
    sortOrder: 1,
  },
  {
    code: 'pro',
    name: 'Pro',
    description: 'For growing teams that live in their inbox.',
    monthlyPriceUsd: '49.00',
    yearlyPriceUsd: '490.00',
    limits: {
      maxChannels: 5,
      maxUsers: 15,
      maxAiRequestsPerMonth: 5000,
      maxKnowledgeDocuments: 20,
      maxProducts: 500,
      maxServices: 500,
    },
    features: [
      '5 connected channels',
      '15 team members',
      '5,000 AI replies / month',
      '20 knowledge documents',
      'Priority support',
    ],
    sortOrder: 2,
  },
  {
    code: 'business',
    name: 'Business',
    description: 'Unlimited everything for established businesses.',
    monthlyPriceUsd: '99.00',
    yearlyPriceUsd: '990.00',
    limits: {
      maxChannels: null,
      maxUsers: null,
      maxAiRequestsPerMonth: null,
      maxKnowledgeDocuments: null,
      maxProducts: null,
      maxServices: null,
    },
    features: [
      'Unlimited channels',
      'Unlimited team members',
      'Unlimited AI replies',
      'Unlimited knowledge documents',
      'Dedicated support',
    ],
    sortOrder: 3,
  },
];

/** The free-trial limits are also the downgrade target for EXPIRED accounts. */
export const FREE_TRIAL_LIMITS: PlanLimits = DEFAULT_PLANS[0].limits;

/**
 * Parse a Plan's raw `limits` JSON into a fully-shaped PlanLimits.
 * Missing / non-numeric keys are treated as unlimited (null), so adding a new
 * limit key never breaks existing plan rows.
 */
export function readPlanLimits(raw: Prisma.JsonValue): PlanLimits {
  const source =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const num = (key: PlanLimitKey): number | null => {
    const v = source[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  return {
    maxChannels: num('maxChannels'),
    maxUsers: num('maxUsers'),
    maxAiRequestsPerMonth: num('maxAiRequestsPerMonth'),
    maxKnowledgeDocuments: num('maxKnowledgeDocuments'),
    maxProducts: num('maxProducts'),
    maxServices: num('maxServices'),
  };
}

// --- Serialized (API) shapes -----------------------------------------------

export interface PlanView {
  code: string;
  name: string;
  description: string | null;
  monthlyPriceUsd: string;
  yearlyPriceUsd: string;
  limits: PlanLimits;
  features: string[];
  sortOrder: number;
}

export interface UsageStat {
  used: number;
  /** null = unlimited on the current plan. */
  limit: number | null;
}

export interface UsageSnapshot {
  channels: UsageStat;
  users: UsageStat;
  aiRequestsThisMonth: UsageStat;
  knowledgeDocuments: UsageStat;
  products: UsageStat;
  services: UsageStat;
}

export interface SubscriptionView {
  plan: PlanView;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  trialEndsAt: Date | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  /** Whole days remaining while TRIALING; null for any other status. */
  daysLeftInTrial: number | null;
  usage: UsageSnapshot;
}

export function serializePlan(plan: Plan): PlanView {
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description,
    monthlyPriceUsd: plan.monthlyPriceUsd.toString(),
    yearlyPriceUsd: plan.yearlyPriceUsd.toString(),
    limits: readPlanLimits(plan.limits),
    features: plan.features,
    sortOrder: plan.sortOrder,
  };
}

/** Subscription row loaded with its plan — the shape most billing code needs. */
export type SubscriptionWithPlan = Prisma.SubscriptionGetPayload<{
  include: { plan: true };
}>;
