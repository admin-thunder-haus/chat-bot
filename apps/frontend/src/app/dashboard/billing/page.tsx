'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { billingApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { useToast } from '@/components/toast';
import type {
  BillingCycle,
  BillingPlan,
  Subscription,
  SubscriptionStatus,
  UsageStat,
} from '@/lib/types';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataList,
  PageHeader,
  Panel,
  SectionCard,
  Skeleton,
  Tabs,
  type DataListColumn,
  type TabItem,
} from '@/components/ui';

/** Humanised subscription states — never show the raw enum (§8). */
const STATUS_BADGE: Record<
  SubscriptionStatus,
  { label: string; color: 'slate' | 'green' | 'red' | 'amber' | 'blue' }
> = {
  TRIALING: { label: 'Trialing', color: 'blue' },
  ACTIVE: { label: 'Active', color: 'green' },
  PAST_DUE: { label: 'Past due', color: 'amber' },
  CANCELED: { label: 'Canceled', color: 'slate' },
  EXPIRED: { label: 'Expired', color: 'red' },
};

type UsageRow = {
  key: keyof Subscription['usage'];
  label: string;
  stat: UsageStat;
};

const USAGE_ROWS: { key: keyof Subscription['usage']; label: string }[] = [
  { key: 'channels', label: 'Connected channels' },
  { key: 'users', label: 'Team members' },
  { key: 'aiRequestsThisMonth', label: 'AI replies this month' },
  { key: 'knowledgeDocuments', label: 'Knowledge documents' },
  { key: 'products', label: 'Products' },
  { key: 'services', label: 'Services' },
];

const CYCLE_TABS: readonly TabItem<BillingCycle>[] = [
  { key: 'MONTHLY', label: 'Monthly' },
  { key: 'YEARLY', label: 'Yearly' },
];

function priceFor(plan: BillingPlan, cycle: BillingCycle): string {
  const raw = cycle === 'YEARLY' ? plan.yearlyPriceUsd : plan.monthlyPriceUsd;
  const n = Number(raw);
  return Number.isFinite(n) ? `$${n}` : `$${raw}`;
}

function usagePercent(stat: UsageStat): number {
  if (stat.limit === null) return stat.used > 0 ? 8 : 0;
  if (stat.limit === 0) return 100;
  return Math.min(100, (stat.used / stat.limit) * 100);
}

/** Proportional bar; the numbers next to it always carry the meaning (§3). */
function UsageBar({ stat }: { stat: UsageStat }) {
  const unlimited = stat.limit === null;
  const over = !unlimited && stat.used >= (stat.limit as number);
  const percent = usagePercent(stat);
  return (
    <div className="h-2 w-full min-w-[80px] overflow-hidden rounded-full bg-slate-100">
      <div
        className={`h-full rounded-full ${
          over ? 'bg-red-500' : percent >= 80 ? 'bg-amber-400' : 'bg-blue-500'
        }`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export default function BillingPage() {
  const { user, features, initializing } = useAuth();
  const { notify } = useToast();
  const router = useRouter();
  const isOwner = user?.role === 'OWNER';
  // Billing is switched off platform-wide (customers are invoiced offline):
  // the route stays mounted but sends the visitor back to the dashboard rather
  // than rendering a page whose every API call answers 410.
  const billingOff = !initializing && !features.billing;

  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [cycle, setCycle] = useState<BillingCycle>('MONTHLY');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [confirmPlan, setConfirmPlan] = useState<BillingPlan | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    // Wait until the platform features are known, and never call the API when
    // billing is off (it answers 410 by design).
    if (initializing || !features.billing) return;
    setLoading(true);
    setError('');
    try {
      const [subRes, plansRes] = await Promise.all([
        billingApi.subscription(),
        billingApi.plans(),
      ]);
      setSubscription(subRes.subscription);
      setPlans(plansRes.plans);
      setCycle(subRes.subscription.billingCycle);
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [initializing, features.billing]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (billingOff) router.replace('/dashboard');
  }, [billingOff, router]);

  async function confirmChangePlan() {
    if (!confirmPlan) return;
    setActionLoading(true);
    try {
      const result = await billingApi.changePlan(confirmPlan.code, cycle);
      if ('checkoutUrl' in result) {
        // Stripe hosted checkout: the webhook applies the plan after payment.
        window.location.href = result.checkoutUrl;
        return;
      }
      setSubscription(result.subscription);
      setConfirmPlan(null);
      notify(
        `Switched to the ${result.subscription.plan.name} plan`,
        'success',
      );
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function doCancel() {
    setActionLoading(true);
    try {
      const res = await billingApi.cancel();
      setSubscription(res.subscription);
      setConfirmCancel(false);
      notify('Subscription will end at the current period', 'success');
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function doResume() {
    setActionLoading(true);
    try {
      const res = await billingApi.resume();
      setSubscription(res.subscription);
      notify('Subscription resumed', 'success');
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setActionLoading(false);
    }
  }

  // Redirecting (or still resolving the flag): render nothing rather than a
  // flash of billing UI that is about to disappear.
  if (initializing || !features.billing) return null;

  const current = subscription?.plan;
  const status = subscription ? STATUS_BADGE[subscription.status] : null;

  const usageColumns: DataListColumn<UsageRow>[] = [
    {
      key: 'label',
      header: 'Resource',
      primary: true,
      cell: (row) => (
        <span className="font-medium text-slate-900">{row.label}</span>
      ),
    },
    {
      key: 'used',
      header: 'Used',
      align: 'right',
      className: 'tabular-nums',
      cell: (row) => row.stat.used,
    },
    {
      key: 'limit',
      header: 'Included',
      align: 'right',
      className: 'tabular-nums',
      cell: (row) =>
        row.stat.limit === null ? (
          'Unlimited'
        ) : row.stat.used >= row.stat.limit ? (
          <span className="font-medium text-red-600">
            {row.stat.limit} · limit reached
          </span>
        ) : (
          row.stat.limit
        ),
    },
    {
      key: 'bar',
      header: 'Usage',
      className: 'w-40',
      cell: (row) => <UsageBar stat={row.stat} />,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Billing"
        description="Your subscription, how much of the plan you are using, and the plans you can switch to."
      />

      <div className="space-y-6">
        {error && (
          <Alert>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{error} Your billing details could not be loaded.</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void load()}
                className="sm:shrink-0"
              >
                Try again
              </Button>
            </div>
          </Alert>
        )}

        {loading || !subscription ? (
          <>
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-64 rounded-xl" />
              ))}
            </div>
          </>
        ) : (
          <>
            {subscription.status === 'EXPIRED' && (
              <Alert
                variant="warning"
                message="Your subscription has expired — AI replies are paused and limits are reduced. Choose a plan below to continue."
              />
            )}
            {subscription.status === 'PAST_DUE' && (
              <Alert
                variant="warning"
                message="Your last payment failed. Update your payment method to keep the subscription active."
              />
            )}

            {/* Current plan */}
            <SectionCard
              title="Current plan"
              actions={
                isOwner &&
                subscription.status !== 'EXPIRED' &&
                subscription.status !== 'CANCELED' ? (
                  subscription.cancelAtPeriodEnd ? (
                    <Button
                      variant="secondary"
                      loading={actionLoading}
                      onClick={doResume}
                    >
                      Resume subscription
                    </Button>
                  ) : (
                    <Button
                      variant="danger"
                      disabled={actionLoading}
                      onClick={() => setConfirmCancel(true)}
                    >
                      Cancel subscription
                    </Button>
                  )
                ) : undefined
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-slate-900">
                  {subscription.plan.name}
                </h3>
                {status && <Badge color={status.color}>{status.label}</Badge>}
                {subscription.status === 'TRIALING' &&
                  subscription.daysLeftInTrial !== null && (
                    <span className="text-sm tabular-nums text-slate-500">
                      {subscription.daysLeftInTrial} day
                      {subscription.daysLeftInTrial === 1 ? '' : 's'} left in
                      trial
                    </span>
                  )}
              </div>
              {subscription.plan.description && (
                <p className="mt-1 text-sm text-slate-500">
                  {subscription.plan.description}
                </p>
              )}
              <p className="mt-2 text-sm text-slate-500">
                Current period ends{' '}
                {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                {subscription.cancelAtPeriodEnd &&
                  ' — cancellation is scheduled, so it will not renew.'}
              </p>
            </SectionCard>

            {/* Usage */}
            <SectionCard
              title="Usage on your plan"
              description="What you have used since the period started."
              padded={false}
            >
              <div className="p-4 sm:p-6">
                <DataList
                  bare
                  items={USAGE_ROWS.map((row) => ({
                    ...row,
                    stat: subscription.usage[row.key],
                  }))}
                  keyOf={(row) => row.key}
                  columns={usageColumns}
                  caption="Plan usage"
                />
              </div>
            </SectionCard>

            {/* Plan catalog */}
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Available plans
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Switch billing period to compare prices.
                </p>
              </div>

              <Tabs
                tabs={CYCLE_TABS}
                value={cycle}
                onChange={setCycle}
                size="sm"
                label="Billing period"
                idPrefix="billing-cycle"
              />

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {plans.map((plan) => {
                  const isCurrent = current?.code === plan.code;
                  const isTrialPlan = plan.code === 'free_trial';
                  const isUpgrade =
                    current !== undefined && plan.sortOrder > current.sortOrder;
                  return (
                    <Panel
                      key={plan.code}
                      className={
                        isCurrent ? 'border-blue-500 ring-1 ring-blue-500' : ''
                      }
                    >
                      <div className="flex h-full flex-col">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="font-semibold text-slate-900">
                            {plan.name}
                          </h3>
                          {isCurrent && (
                            <Badge color="blue">Current plan</Badge>
                          )}
                        </div>
                        <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                          {priceFor(plan, cycle)}
                          <span className="text-sm font-normal text-slate-500">
                            {cycle === 'YEARLY' ? '/year' : '/month'}
                          </span>
                        </p>
                        {plan.description && (
                          <p className="mt-1 text-xs text-slate-500">
                            {plan.description}
                          </p>
                        )}
                        <ul className="mt-3 flex-1 space-y-1 text-sm text-slate-600">
                          {plan.features.map((f) => (
                            <li key={f} className="flex items-start gap-1.5">
                              <span
                                className="text-green-600"
                                aria-hidden="true"
                              >
                                ✓
                              </span>
                              {f}
                            </li>
                          ))}
                        </ul>
                        {isOwner && !isCurrent && !isTrialPlan && (
                          <Button
                            className="mt-4"
                            fullWidth
                            variant={isUpgrade ? 'primary' : 'secondary'}
                            disabled={actionLoading}
                            onClick={() => setConfirmPlan(plan)}
                          >
                            {isUpgrade
                              ? `Upgrade to ${plan.name}`
                              : `Switch to ${plan.name}`}
                          </Button>
                        )}
                        {isTrialPlan && !isCurrent && (
                          <p className="mt-4 text-center text-xs text-slate-500">
                            New accounts start here
                          </p>
                        )}
                      </div>
                    </Panel>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmPlan !== null}
        title="Change plan"
        message={
          confirmPlan
            ? `Switch to the ${confirmPlan.name} plan at ${priceFor(
                confirmPlan,
                cycle,
              )}/${cycle === 'YEARLY' ? 'year' : 'month'}? The change takes effect immediately.`
            : ''
        }
        confirmLabel="Change plan"
        loading={actionLoading}
        onConfirm={confirmChangePlan}
        onCancel={() => setConfirmPlan(null)}
      />

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel subscription"
        message="Your subscription stays active until the end of the current period, then stops renewing. You can resume any time before then."
        confirmLabel="Cancel subscription"
        loading={actionLoading}
        onConfirm={doCancel}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}
