import { request } from '../api';
import type {
  BillingCycle,
  BillingPlan,
  ChangePlanResult,
  Subscription,
} from '../types';

export const billingApi = {
  subscription(): Promise<{ subscription: Subscription }> {
    return request('/billing/subscription', { auth: true });
  },
  plans(): Promise<{ plans: BillingPlan[] }> {
    return request('/billing/plans', { auth: true });
  },
  /** OWNER only. May return { checkoutUrl } when Stripe checkout is active. */
  changePlan(
    planCode: string,
    billingCycle: BillingCycle,
  ): Promise<ChangePlanResult> {
    return request('/billing/change-plan', {
      method: 'POST',
      body: { planCode, billingCycle },
      auth: true,
    });
  },
  cancel(): Promise<{ subscription: Subscription }> {
    return request('/billing/cancel', { method: 'POST', body: {}, auth: true });
  },
  resume(): Promise<{ subscription: Subscription }> {
    return request('/billing/resume', { method: 'POST', body: {}, auth: true });
  },
};
