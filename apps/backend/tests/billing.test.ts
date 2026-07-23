import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import {
  authHeader,
  makeConversation,
  makeCustomer,
  setupTenant,
  type Tenant,
} from './helpers';
import { prisma } from './setup';
import { createFakeChannel } from './channel-helpers';
import { env } from '../src/config/env';
import { ensureDefaultPlans } from '../src/modules/billing/billing.plans';
import { setStripeTransportForTesting } from '../src/modules/billing/stripe.provider';
import { setAIProviderForTesting } from '../src/modules/ai';
import { makeFakeProvider } from './ai-helpers';

/**
 * Billing & subscriptions: trial lifecycle, plan catalog, plan changes,
 * cancel/resume, plan-limit enforcement seams, lazy expiry, and the Stripe
 * webhook surface.
 *
 * NOTE resetDatabase(): subscriptions cascade with their company (FK
 * onDelete: Cascade), so no explicit subscription cleanup is needed. Plan
 * rows are a global catalog and intentionally survive resets (upserts keep
 * them consistent).
 */

const app = createApp();
let acme: Tenant;

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await ensureDefaultPlans();
  acme = await setupTenant('acme');
});

afterEach(() => {
  setStripeTransportForTesting(null);
  setAIProviderForTesting(null);
  env.STRIPE_SECRET_KEY = undefined;
  env.STRIPE_WEBHOOK_SECRET = undefined;
});

function getSubscription(token: string) {
  return request(app)
    .get('/api/v1/billing/subscription')
    .set(authHeader(token));
}

/** Seed a deliberately tiny plan to exercise limit enforcement. */
async function seedTightPlan() {
  const limits = {
    maxChannels: 0,
    maxUsers: null,
    maxAiRequestsPerMonth: 0,
    maxKnowledgeDocuments: 0,
    maxProducts: null,
    maxServices: null,
  };
  await prisma.plan.upsert({
    where: { code: 'test_tight' },
    update: { limits, isActive: true },
    create: {
      code: 'test_tight',
      name: 'Tight (test)',
      monthlyPriceUsd: '1.00',
      yearlyPriceUsd: '10.00',
      limits,
      features: [],
      isActive: true,
      sortOrder: 99,
    },
  });
}

describe('GET /api/v1/billing/subscription', () => {
  it('lazily creates a TRIALING free-trial subscription on first read', async () => {
    const before = await prisma.subscription.findUnique({
      where: { companyId: acme.company.id },
    });
    expect(before).toBeNull();

    const res = await getSubscription(acme.tokens.agent); // any role
    expect(res.status).toBe(200);
    const sub = res.body.data.subscription;
    expect(sub.status).toBe('TRIALING');
    expect(sub.plan.code).toBe('free_trial');
    expect(sub.plan.limits.maxChannels).toBe(1);
    expect(sub.daysLeftInTrial).toBeGreaterThanOrEqual(13);
    expect(sub.daysLeftInTrial).toBeLessThanOrEqual(14);
    expect(sub.usage.channels).toEqual({ used: 0, limit: 1 });
    expect(sub.usage.users).toEqual({ used: 3, limit: 2 }); // 3 fixture users
    expect(sub.usage.aiRequestsThisMonth.limit).toBe(200);

    // Second read reuses the same subscription row.
    await getSubscription(acme.tokens.owner);
    const count = await prisma.subscription.count({
      where: { companyId: acme.company.id },
    });
    expect(count).toBe(1);
  });

  it('registration starts the free trial for the new company', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      companyName: 'Trial Co',
      fullName: 'Trial Owner',
      email: 'trial-owner@test.com',
      password: 'Password1',
      confirmPassword: 'Password1',
    });
    expect(res.status).toBe(201);

    const companyId = res.body.data.company.id as string;
    const sub = await prisma.subscription.findUnique({
      where: { companyId },
      include: { plan: true },
    });
    expect(sub).not.toBeNull();
    expect(sub!.status).toBe('TRIALING');
    expect(sub!.plan.code).toBe('free_trial');
    expect(sub!.trialEndsAt).not.toBeNull();
  });
});

describe('GET /api/v1/billing/plans', () => {
  it('lists the default catalog in sort order (any role)', async () => {
    const res = await request(app)
      .get('/api/v1/billing/plans')
      .set(authHeader(acme.tokens.agent));
    expect(res.status).toBe(200);
    const codes = res.body.data.plans.map((p: { code: string }) => p.code);
    expect(codes.slice(0, 4)).toEqual([
      'free_trial',
      'starter',
      'pro',
      'business',
    ]);
    const business = res.body.data.plans.find(
      (p: { code: string }) => p.code === 'business',
    );
    expect(business.limits.maxChannels).toBeNull(); // unlimited
    expect(business.monthlyPriceUsd).toBe('99');
  });
});

describe('POST /api/v1/billing/change-plan', () => {
  it('OWNER can switch plans (offline mode applies immediately)', async () => {
    const res = await request(app)
      .post('/api/v1/billing/change-plan')
      .set(authHeader(acme.tokens.owner))
      .send({ planCode: 'starter', billingCycle: 'YEARLY' });
    expect(res.status).toBe(200);
    const sub = res.body.data.subscription;
    expect(sub.status).toBe('ACTIVE');
    expect(sub.plan.code).toBe('starter');
    expect(sub.billingCycle).toBe('YEARLY');
    expect(sub.trialEndsAt).toBeNull();
    const periodMs =
      new Date(sub.currentPeriodEnd).getTime() -
      new Date(sub.currentPeriodStart).getTime();
    expect(periodMs).toBeGreaterThan(360 * DAY_MS);
  });

  it('ADMIN and AGENT are forbidden', async () => {
    for (const token of [acme.tokens.admin, acme.tokens.agent]) {
      const res = await request(app)
        .post('/api/v1/billing/change-plan')
        .set(authHeader(token))
        .send({ planCode: 'starter', billingCycle: 'MONTHLY' });
      expect(res.status).toBe(403);
    }
  });

  it('the free trial cannot be re-selected and unknown plans 404', async () => {
    const trial = await request(app)
      .post('/api/v1/billing/change-plan')
      .set(authHeader(acme.tokens.owner))
      .send({ planCode: 'free_trial', billingCycle: 'MONTHLY' });
    expect(trial.status).toBe(400);

    const missing = await request(app)
      .post('/api/v1/billing/change-plan')
      .set(authHeader(acme.tokens.owner))
      .send({ planCode: 'no_such_plan', billingCycle: 'MONTHLY' });
    expect(missing.status).toBe(404);
  });
});

describe('cancel / resume', () => {
  it('OWNER can cancel at period end and resume again', async () => {
    const cancel = await request(app)
      .post('/api/v1/billing/cancel')
      .set(authHeader(acme.tokens.owner))
      .send({});
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.subscription.cancelAtPeriodEnd).toBe(true);
    expect(cancel.body.data.subscription.canceledAt).not.toBeNull();

    const resume = await request(app)
      .post('/api/v1/billing/resume')
      .set(authHeader(acme.tokens.owner))
      .send({});
    expect(resume.status).toBe(200);
    expect(resume.body.data.subscription.cancelAtPeriodEnd).toBe(false);
    expect(resume.body.data.subscription.canceledAt).toBeNull();
  });

  it('AGENT cannot cancel', async () => {
    const res = await request(app)
      .post('/api/v1/billing/cancel')
      .set(authHeader(acme.tokens.agent))
      .send({});
    expect(res.status).toBe(403);
  });
});

describe('plan-limit enforcement', () => {
  beforeEach(async () => {
    await seedTightPlan();
    const res = await request(app)
      .post('/api/v1/billing/change-plan')
      .set(authHeader(acme.tokens.owner))
      .send({ planCode: 'test_tight', billingCycle: 'MONTHLY' });
    expect(res.status).toBe(200);
  });

  it('blocks knowledge-document uploads over the plan cap', async () => {
    const res = await request(app)
      .post('/api/v1/knowledge-documents')
      .set(authHeader(acme.tokens.owner))
      .attach('files', Buffer.from('%PDF-1.4 test'), {
        filename: 'doc.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PLAN_LIMIT_REACHED');
    expect(
      await prisma.knowledgeDocument.count({
        where: { companyId: acme.company.id },
      }),
    ).toBe(0);
  });

  it('blocks connecting channels over the plan cap', async () => {
    const res = await createFakeChannel(app, acme.tokens.owner);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('blocks AI generation over the plan monthly request cap', async () => {
    setAIProviderForTesting(makeFakeProvider().provider);
    const customer = await makeCustomer(acme.company.id);
    const conv = await makeConversation(acme.company.id, customer.id);
    await prisma.message.create({
      data: {
        companyId: acme.company.id,
        conversationId: conv.id,
        customerId: customer.id,
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        content: 'Hello?',
        status: 'RECEIVED',
        sentAt: new Date(),
      },
    });
    const res = await request(app)
      .post(`/api/v1/conversations/${conv.id}/ai/draft`)
      .set(authHeader(acme.tokens.owner))
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('companies without a subscription row are not limited (legacy fixtures)', async () => {
    const globex = await setupTenant('globex');
    const res = await createFakeChannel(app, globex.tokens.owner);
    expect(res.status).toBe(201);
  });
});

describe('lazy expiry (no cron)', () => {
  it('an overdue trial becomes EXPIRED and blocks AI with a clear error', async () => {
    await getSubscription(acme.tokens.owner); // create the trial
    await prisma.subscription.updateMany({
      where: { companyId: acme.company.id },
      data: {
        trialEndsAt: new Date(Date.now() - DAY_MS),
        currentPeriodEnd: new Date(Date.now() - DAY_MS),
      },
    });

    setAIProviderForTesting(makeFakeProvider().provider);
    const customer = await makeCustomer(acme.company.id);
    const conv = await makeConversation(acme.company.id, customer.id);
    await prisma.message.create({
      data: {
        companyId: acme.company.id,
        conversationId: conv.id,
        customerId: customer.id,
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        content: 'Anyone there?',
        status: 'RECEIVED',
        sentAt: new Date(),
      },
    });

    const draft = await request(app)
      .post(`/api/v1/conversations/${conv.id}/ai/draft`)
      .set(authHeader(acme.tokens.owner))
      .send({});
    expect(draft.status).toBe(403);
    expect(draft.body.code).toBe('SUBSCRIPTION_EXPIRED');
    expect(draft.body.message).toMatch(/expired/i);

    // The lazy flip is persisted and visible on the billing page.
    const after = await getSubscription(acme.tokens.owner);
    expect(after.body.data.subscription.status).toBe('EXPIRED');
    expect(after.body.data.subscription.daysLeftInTrial).toBeNull();
  });
});

describe('Stripe integration', () => {
  it('changePlan routes through hosted checkout when Stripe is configured', async () => {
    env.STRIPE_SECRET_KEY = 'sk_test_not_real';
    const calls: { path: string; body?: string }[] = [];
    setStripeTransportForTesting(async (path, init) => {
      calls.push({ path, body: init.body });
      return {
        status: 200,
        body: { url: 'https://checkout.stripe.com/c/test-session' },
      };
    });

    const res = await request(app)
      .post('/api/v1/billing/change-plan')
      .set(authHeader(acme.tokens.owner))
      .send({ planCode: 'pro', billingCycle: 'MONTHLY' });
    expect(res.status).toBe(200);
    expect(res.body.data.checkoutUrl).toBe(
      'https://checkout.stripe.com/c/test-session',
    );

    // Nothing applied locally until the webhook confirms payment.
    const sub = await prisma.subscription.findUnique({
      where: { companyId: acme.company.id },
      include: { plan: true },
    });
    expect(sub!.plan.code).toBe('free_trial');

    expect(calls[0].path).toBe('/v1/checkout/sessions');
    expect(calls[0].body).toContain('mode=subscription');
    expect(calls[0].body).toContain(encodeURIComponent(acme.company.id));
  });

  it('checkout.session.completed applies the paid plan', async () => {
    await getSubscription(acme.tokens.owner);
    const res = await request(app)
      .post('/api/v1/billing/webhook/stripe')
      .send({
        type: 'checkout.session.completed',
        data: {
          object: {
            customer: 'cus_test_1',
            subscription: 'sub_test_1',
            metadata: {
              companyId: acme.company.id,
              planCode: 'pro',
              billingCycle: 'YEARLY',
            },
          },
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.data.handled).toBe(true);

    const sub = await prisma.subscription.findUnique({
      where: { companyId: acme.company.id },
      include: { plan: true },
    });
    expect(sub!.status).toBe('ACTIVE');
    expect(sub!.plan.code).toBe('pro');
    expect(sub!.billingCycle).toBe('YEARLY');
    expect(sub!.externalSubscriptionId).toBe('sub_test_1');
    expect(sub!.paymentProvider).toBe('stripe');

    // A later status push from Stripe maps onto our statuses.
    const pastDue = await request(app)
      .post('/api/v1/billing/webhook/stripe')
      .send({
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_test_1', status: 'past_due' } },
      });
    expect(pastDue.body.data.handled).toBe(true);
    const updated = await prisma.subscription.findUnique({
      where: { companyId: acme.company.id },
    });
    expect(updated!.status).toBe('PAST_DUE');
  });

  it('rejects webhooks with a bad signature when the secret is set', async () => {
    env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
    const payload = JSON.stringify({ type: 'checkout.session.completed' });

    const missing = await request(app)
      .post('/api/v1/billing/webhook/stripe')
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(missing.status).toBe(400);

    const bad = await request(app)
      .post('/api/v1/billing/webhook/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 't=123,v1=deadbeef')
      .send(payload);
    expect(bad.status).toBe(400);

    // A correctly signed payload is accepted.
    const t = Math.floor(Date.now() / 1000).toString();
    const v1 = crypto
      .createHmac('sha256', 'whsec_test_secret')
      .update(`${t}.${payload}`)
      .digest('hex');
    const good = await request(app)
      .post('/api/v1/billing/webhook/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', `t=${t},v1=${v1}`)
      .send(payload);
    expect(good.status).toBe(200);
  });
});
