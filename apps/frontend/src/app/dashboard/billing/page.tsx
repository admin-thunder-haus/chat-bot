'use client';

import { useCallback, useEffect, useState } from 'react';
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
  PageHeader,
  Panel,
  Skeleton,
} from '@/components/ui';

const STATUS_BADGE: Record<
  SubscriptionStatus,
  { label: string; color: 'slate' | 'green' | 'red' | 'amber' | 'blue' }
> = {
  TRIALING: { label: 'Trial', color: 'blue' },
  ACTIVE: { label: 'Active', color: 'green' },
  PAST_DUE: { label: 'Past due', color: 'amber' },
  CANCELED: { label: 'Canceled', color: 'slate' },
  EXPIRED: { label: 'Expired', color: 'red' },
};

const USAGE_ROWS: { key: keyof Subscription['usage']; label: string }[] = [
  { key: 'channels', label: 'Connected channels' },
  { key: 'users', label: 'Team members' },
  { key: 'aiRequestsThisMonth', label: 'AI replies this month' },
  { key: 'knowledgeDocuments', label: 'Knowledge documents' },
  { key: 'products', label: 'Products' },
  { key: 'services', label: 'Services' },
];

function priceFor(plan: BillingPlan, cycle: BillingCycle): string {
  const raw = cycle === 'YEARLY' ? plan.yearlyPriceUsd : plan.monthlyPriceUsd;
  const n = Number(raw);
  return Number.isFinite(n) ? `$${n}` : `$${raw}`;
}

function UsageBar({ label, stat }: { label: string; stat: UsageStat }) {
  const unlimited = stat.limit === null;
  const over = !unlimited && stat.used >= (stat.limit as number);
  const percent = unlimited
    ? stat.used > 0
      ? 8
      : 0
    : Math.min(100, ((stat.limit as number) === 0 ? 100 : (stat.used / (stat.limit as number)) * 100));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-slate-600">{label}</span>
        <span className={over ? 'font-medium text-red-600' : 'text-slate-500'}>
          {stat.used} / {unlimited ? '∞' : stat.limit}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${
            over ? 'bg-red-500' : percent >= 80 ? 'bg-amber-400' : 'bg-blue-500'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export default function BillingPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const isOwner = user?.role === 'OWNER';

  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [cycle, setCycle] = useState<BillingCycle>('MONTHLY');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [confirmPlan, setConfirmPlan] = useState<BillingPlan | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      notify(`Switched to the ${result.subscription.plan.name} plan`, 'success');
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

  const current = subscription?.plan;
  const status = subscription ? STATUS_BADGE[subscription.status] : null;

  return (
    <div>
      <PageHeader
        title="Billing"
        description="Your subscription, usage, and available plans."
      />

      {error && (
        <div className="mb-4">
          <Alert message={error} />
        </div>
      )}

      {loading || !subscription ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          {subscription.status === 'EXPIRED' && (
            <div className="mb-4">
              <Alert
                variant="warning"
                message="Your subscription has expired — AI replies are paused and limits are reduced. Choose a plan below to continue."
              />
            </div>
          )}
          {subscription.status === 'PAST_DUE' && (
            <div className="mb-4">
              <Alert
                variant="warning"
                message="Your last payment failed. Please update your payment to keep the subscription active."
              />
            </div>
          )}

          {/* Current plan */}
          <Panel className="mb-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-900">
                    {subscription.plan.name}
                  </h2>
                  {status && <Badge color={status.color}>{status.label}</Badge>}
                  {subscription.status === 'TRIALING' &&
                    subscription.daysLeftInTrial !== null && (
                      <span className="text-sm text-slate-500">
                        {subscription.daysLeftInTrial} day
                        {subscription.daysLeftInTrial === 1 ? '' : 's'} left in
                        trial
                      </span>
                    )}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {subscription.plan.description}
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  Current period ends{' '}
                  {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                  {subscription.cancelAtPeriodEnd &&
                    ' — subscription ends then (cancellation scheduled)'}
                </p>
              </div>
              {isOwner &&
                subscription.status !== 'EXPIRED' &&
                subscription.status !== 'CANCELED' &&
                (subscription.cancelAtPeriodEnd ? (
                  <Button
                    variant="secondary"
                    disabled={actionLoading}
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
                ))}
            </div>
          </Panel>

          {/* Usage */}
          <Panel className="mb-6">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Usage on your plan
            </h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {USAGE_ROWS.map((row) => (
                <UsageBar
                  key={row.key}
                  label={row.label}
                  stat={subscription.usage[row.key]}
                />
              ))}
            </div>
          </Panel>

          {/* Plan catalog */}
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              Plans
            </h3>
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm">
              {(['MONTHLY', 'YEARLY'] as BillingCycle[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCycle(c)}
                  className={`rounded-md px-3 py-1 ${
                    cycle === c
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {c === 'MONTHLY' ? 'Monthly' : 'Yearly'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => {
              const isCurrent = current?.code === plan.code;
              const isTrialPlan = plan.code === 'free_trial';
              const isUpgrade =
                current !== undefined && plan.sortOrder > current.sortOrder;
              return (
                <Panel
                  key={plan.code}
                  className={isCurrent ? 'border-blue-500 ring-1 ring-blue-500' : ''}
                >
                  <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-slate-900">{plan.name}</h4>
                      {isCurrent && <Badge color="blue">Current</Badge>}
                    </div>
                    <p className="mt-1 text-2xl font-bold text-slate-900">
                      {priceFor(plan, cycle)}
                      <span className="text-sm font-normal text-slate-500">
                        /{cycle === 'YEARLY' ? 'yr' : 'mo'}
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
                          <span className="text-green-600">✓</span>
                          {f}
                        </li>
                      ))}
                    </ul>
                    {isOwner && !isCurrent && !isTrialPlan && (
                      <Button
                        className="mt-4"
                        variant={isUpgrade ? 'primary' : 'secondary'}
                        disabled={actionLoading}
                        onClick={() => setConfirmPlan(plan)}
                      >
                        {isUpgrade ? 'Upgrade' : 'Downgrade'}
                      </Button>
                    )}
                    {isTrialPlan && !isCurrent && (
                      <p className="mt-4 text-center text-xs text-slate-400">
                        New accounts start here
                      </p>
                    )}
                  </div>
                </Panel>
              );
            })}
          </div>
        </>
      )}

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
        message="Your subscription will remain active until the end of the current period, then stop renewing. You can resume any time before then."
        confirmLabel="Cancel subscription"
        loading={actionLoading}
        onConfirm={doCancel}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}
