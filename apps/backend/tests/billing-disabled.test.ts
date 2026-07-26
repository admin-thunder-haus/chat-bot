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
import { ensureDefaultPlans } from '../src/modules/billing/billing.plans';
import { setAIProviderForTesting } from '../src/modules/ai';
import { makeFakeProvider } from './ai-helpers';

/**
 * BILLING_ENABLED=false — the PLATFORM DEFAULT while customers are invoiced
 * offline (bank transfer / cash). The module stays in the codebase but must be
 * completely inert:
 *
 *   - no plan limit is ever enforced (no PLAN_LIMIT_REACHED / SUBSCRIPTION_EXPIRED)
 *   - registration creates NO subscription row
 *   - the billing API (including the Stripe webhook) answers 410 BILLING_DISABLED
 *   - the auth payload reports features.billing = false so the UI hides it
 *
 * Crucially, the tenants below are seeded with a DELIBERATELY TIGHT plan and an
 * ALREADY-EXPIRED subscription: with billing on, every request here would be
 * rejected. Nothing may be rejected with billing off.
 */

const app = createApp();
let acme: Tenant;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Give the tenant a zero-everything, long-expired subscription. */
async function seedHostileSubscription(companyId: string): Promise<void> {
  const limits = {
    maxChannels: 0,
    maxUsers: 0,
    maxAiRequestsPerMonth: 0,
    maxKnowledgeDocuments: 0,
    maxProducts: 0,
    maxServices: 0,
  };
  const plan = await prisma.plan.upsert({
    where: { code: 'test_zero' },
    update: { limits, isActive: true },
    create: {
      code: 'test_zero',
      name: 'Zero (test)',
      monthlyPriceUsd: '1.00',
      yearlyPriceUsd: '10.00',
      limits,
      features: [],
      isActive: true,
      sortOrder: 98,
    },
  });
  const past = new Date(Date.now() - 30 * DAY_MS);
  await prisma.subscription.create({
    data: {
      companyId,
      planId: plan.id,
      status: 'EXPIRED',
      billingCycle: 'MONTHLY',
      currentPeriodStart: past,
      currentPeriodEnd: past,
    },
  });
}

beforeEach(async () => {
  // Explicit rather than relying on the default, so the intent is unmistakable
  // and a future default change cannot silently turn this suite into a no-op.
  process.env.BILLING_ENABLED = 'false';
  await ensureDefaultPlans();
  acme = await setupTenant('acme');
});

afterEach(() => {
  delete process.env.BILLING_ENABLED;
  setAIProviderForTesting(null);
});

describe('billing disabled: nothing is limited', () => {
  it('connects a channel despite a zero-channel expired plan', async () => {
    await seedHostileSubscription(acme.company.id);
    const res = await createFakeChannel(app, acme.tokens.owner);
    expect(res.status).toBe(201);
  });

  it('uploads a knowledge document despite a zero-document expired plan', async () => {
    await seedHostileSubscription(acme.company.id);
    const res = await request(app)
      .post('/api/v1/knowledge-documents')
      .set(authHeader(acme.tokens.owner))
      .attach('files', Buffer.from('%PDF-1.4 test'), {
        filename: 'doc.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(201);
    expect(
      await prisma.knowledgeDocument.count({
        where: { companyId: acme.company.id },
      }),
    ).toBe(1);
  });

  it('generates an AI draft despite a zero-request EXPIRED subscription', async () => {
    await seedHostileSubscription(acme.company.id);
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
    expect(res.status).toBe(200);
    expect(res.body.code).toBeUndefined();
  });

  it('never flips a subscription to EXPIRED as a side effect', async () => {
    await seedHostileSubscription(acme.company.id);
    await prisma.subscription.updateMany({
      where: { companyId: acme.company.id },
      data: { status: 'TRIALING' },
    });

    await createFakeChannel(app, acme.tokens.owner);

    const sub = await prisma.subscription.findUnique({
      where: { companyId: acme.company.id },
    });
    // Lazy expiry is part of the limit checks, which never ran.
    expect(sub!.status).toBe('TRIALING');
  });
});

describe('billing disabled: no subscription rows are created', () => {
  it('registration starts no trial subscription', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      companyName: 'Offline Co',
      fullName: 'Offline Owner',
      email: 'offline-owner@test.com',
      password: 'StrongPassw0rd!',
      confirmPassword: 'StrongPassw0rd!',
    });
    expect(res.status).toBe(201);

    const company = await prisma.company.findFirst({
      where: { name: 'Offline Co' },
    });
    expect(company).not.toBeNull();
    expect(
      await prisma.subscription.count({ where: { companyId: company!.id } }),
    ).toBe(0);
  });

  it('exercising the feature seams creates no subscription row', async () => {
    await createFakeChannel(app, acme.tokens.owner);
    await request(app)
      .post('/api/v1/knowledge-documents')
      .set(authHeader(acme.tokens.owner))
      .attach('files', Buffer.from('%PDF-1.4 test'), {
        filename: 'doc.pdf',
        contentType: 'application/pdf',
      });

    expect(
      await prisma.subscription.count({ where: { companyId: acme.company.id } }),
    ).toBe(0);
  });
});

describe('billing disabled: the API surface is gone', () => {
  it.each([
    ['get', '/api/v1/billing/subscription'],
    ['get', '/api/v1/billing/plans'],
  ] as const)('%s %s answers 410 BILLING_DISABLED', async (method, path) => {
    const res = await request(app)[method](path).set(
      authHeader(acme.tokens.owner),
    );
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('BILLING_DISABLED');
  });

  it('change-plan / cancel / resume are gone', async () => {
    for (const path of ['/change-plan', '/cancel', '/resume']) {
      const res = await request(app)
        .post(`/api/v1/billing${path}`)
        .set(authHeader(acme.tokens.owner))
        .send({ planCode: 'pro', billingCycle: 'MONTHLY' });
      expect(res.status).toBe(410);
    }
  });

  it('the Stripe webhook is gone and processes nothing', async () => {
    const res = await request(app)
      .post('/api/v1/billing/webhook/stripe')
      .send({
        type: 'checkout.session.completed',
        data: {
          object: {
            metadata: {
              companyId: acme.company.id,
              planCode: 'pro',
              billingCycle: 'YEARLY',
            },
          },
        },
      });
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('BILLING_DISABLED');
    expect(
      await prisma.subscription.count({ where: { companyId: acme.company.id } }),
    ).toBe(0);
  });
});

describe('platform features in the auth payload', () => {
  it('reports billing: false so the dashboard hides it', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set(authHeader(acme.tokens.owner));
    expect(res.status).toBe(200);
    expect(res.body.data.features.billing).toBe(false);
  });

  it('reports billing: true once the single env var is flipped', async () => {
    process.env.BILLING_ENABLED = 'true';
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set(authHeader(acme.tokens.owner));
    expect(res.body.data.features.billing).toBe(true);
  });
});
