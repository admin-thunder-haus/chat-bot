import crypto from 'node:crypto';
import type { BillingCycle, Plan, Subscription } from '@prisma/client';
import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import type {
  CheckoutResult,
  PaymentProvider,
} from './payment-provider.interface';

/**
 * Stripe payment provider implemented against the RAW Stripe REST API
 * (form-encoded over fetch) — no SDK dependency. Active only when
 * STRIPE_SECRET_KEY is set; otherwise the billing service runs offline.
 *
 * The HTTP transport is injectable so tests never touch api.stripe.com.
 */

const STRIPE_API_BASE = 'https://api.stripe.com';

export interface StripeTransportResponse {
  status: number;
  body: unknown;
}

export type StripeTransport = (
  path: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<StripeTransportResponse>;

let transportOverride: StripeTransport | null = null;

/** Inject a fake Stripe HTTP transport in tests (null restores the default). */
export function setStripeTransportForTesting(
  transport: StripeTransport | null,
): void {
  transportOverride = transport;
}

const defaultTransport: StripeTransport = async (path, init) => {
  const res = await fetch(`${STRIPE_API_BASE}${path}`, init);
  const body: unknown = await res.json().catch(() => null);
  return { status: res.status, body };
};

/** True when the Stripe provider should handle plan changes. */
export function isStripeConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

async function stripeRequest(
  path: string,
  params: Record<string, string>,
): Promise<unknown> {
  const transport = transportOverride ?? defaultTransport;
  const res = await transport(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  if (res.status >= 400) {
    // Never leak Stripe error payloads (they can echo request details).
    logger.error('stripe.request.failed', { path, status: res.status });
    throw AppError.internal('Payment provider request failed');
  }
  return res.body;
}

export const stripeProvider: PaymentProvider = {
  name: 'stripe',

  async createCheckout(
    companyId: string,
    plan: Plan,
    cycle: BillingCycle,
  ): Promise<CheckoutResult | null> {
    if (!isStripeConfigured()) return null;

    const price = cycle === 'YEARLY' ? plan.yearlyPriceUsd : plan.monthlyPriceUsd;
    const unitAmountCents = Math.round(Number(price.toString()) * 100);
    // The dashboard origin (first CORS origin) hosts the billing page the
    // customer returns to after checkout.
    const origin = env.CORS_ORIGINS[0] ?? 'http://localhost:3000';

    const session = (await stripeRequest('/v1/checkout/sessions', {
      mode: 'subscription',
      client_reference_id: companyId,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(unitAmountCents),
      'line_items[0][price_data][recurring][interval]':
        cycle === 'YEARLY' ? 'year' : 'month',
      'line_items[0][price_data][product_data][name]': `${plan.name} plan`,
      // Metadata on BOTH the session and the subscription so every webhook
      // event can be mapped back to the tenant + plan.
      'metadata[companyId]': companyId,
      'metadata[planCode]': plan.code,
      'metadata[billingCycle]': cycle,
      'subscription_data[metadata][companyId]': companyId,
      'subscription_data[metadata][planCode]': plan.code,
      'subscription_data[metadata][billingCycle]': cycle,
      success_url: `${origin}/dashboard/billing?checkout=success`,
      cancel_url: `${origin}/dashboard/billing?checkout=cancelled`,
    })) as { url?: unknown } | null;

    return session && typeof session.url === 'string'
      ? { url: session.url }
      : null;
  },

  async cancelExternal(subscription: Subscription): Promise<void> {
    if (!isStripeConfigured() || !subscription.externalSubscriptionId) return;
    // Mirror local semantics: the Stripe subscription runs out at period end.
    await stripeRequest(
      `/v1/subscriptions/${subscription.externalSubscriptionId}`,
      { cancel_at_period_end: 'true' },
    );
  },
};

/**
 * Verify a `Stripe-Signature` header (t=...,v1=... / HMAC-SHA256 of
 * "<t>.<rawBody>"). When STRIPE_WEBHOOK_SECRET is unset verification is
 * skipped (accepted) — set the secret in any real deployment.
 */
export function verifyStripeSignature(
  rawBody: Buffer | undefined,
  header: string | undefined,
): boolean {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!rawBody || !header) return false;

  let timestamp: string | null = null;
  let signature: string | null = null;
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') timestamp = value;
    if (key === 'v1') signature = value;
  }
  if (!timestamp || !signature) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(signature, 'utf8'),
    );
  } catch {
    return false;
  }
}
