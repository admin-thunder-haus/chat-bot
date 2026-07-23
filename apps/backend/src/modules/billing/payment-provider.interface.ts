import type { BillingCycle, Plan, Subscription } from '@prisma/client';

export interface CheckoutResult {
  /** Hosted checkout page the customer must be redirected to. */
  url: string;
}

/**
 * Generic payment-provider abstraction. The billing service is provider-
 * agnostic: when a provider is configured, plan changes route through its
 * hosted checkout and are applied by its webhook; when none is configured the
 * platform runs in OFFLINE billing mode and plan changes apply immediately.
 */
export interface PaymentProvider {
  readonly name: string;

  /**
   * Create a hosted checkout session for the given plan + cycle.
   * Returning null means the provider cannot handle this checkout and the
   * caller should fall back to applying the change offline.
   */
  createCheckout(
    companyId: string,
    plan: Plan,
    cycle: BillingCycle,
  ): Promise<CheckoutResult | null>;

  /** Cancel the provider-side subscription (at period end), if one is linked. */
  cancelExternal(subscription: Subscription): Promise<void>;
}
