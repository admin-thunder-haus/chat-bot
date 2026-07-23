import type { Plan, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import type { SubscriptionWithPlan } from './billing.types';

/**
 * Data-access for billing. Subscriptions are unique per company; plans are a
 * global (non-tenant) catalog.
 */
export const billingRepository = {
  listActivePlans(): Promise<Plan[]> {
    return prisma.plan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
  },

  findPlanByCode(code: string): Promise<Plan | null> {
    return prisma.plan.findUnique({ where: { code } });
  },

  findSubscription(companyId: string): Promise<SubscriptionWithPlan | null> {
    return prisma.subscription.findUnique({
      where: { companyId },
      include: { plan: true },
    });
  },

  findByExternalSubscriptionId(
    externalSubscriptionId: string,
  ): Promise<SubscriptionWithPlan | null> {
    return prisma.subscription.findFirst({
      where: { externalSubscriptionId },
      include: { plan: true },
    });
  },

  createSubscription(
    data: Prisma.SubscriptionUncheckedCreateInput,
  ): Promise<SubscriptionWithPlan> {
    return prisma.subscription.create({ data, include: { plan: true } });
  },

  updateSubscription(
    id: string,
    data: Prisma.SubscriptionUncheckedUpdateInput,
  ): Promise<SubscriptionWithPlan> {
    return prisma.subscription.update({
      where: { id },
      data,
      include: { plan: true },
    });
  },

  /** Raw usage counts for the billing page + limit checks. */
  async usageCounts(companyId: string): Promise<{
    channels: number;
    users: number;
    aiRequestsThisMonth: number;
    knowledgeDocuments: number;
    products: number;
    services: number;
  }> {
    const [channels, users, aiRequestsThisMonth, knowledgeDocuments, products, services] =
      await Promise.all([
        this.channelCount(companyId),
        prisma.user.count({ where: { companyId, status: 'ACTIVE' } }),
        this.monthlyAiRequestCount(companyId),
        prisma.knowledgeDocument.count({ where: { companyId } }),
        prisma.product.count({ where: { companyId } }),
        prisma.businessService.count({ where: { companyId } }),
      ]);
    return { channels, users, aiRequestsThisMonth, knowledgeDocuments, products, services };
  },

  /** Connected channel accounts (soft-disconnected ones free up the slot). */
  channelCount(companyId: string): Promise<number> {
    return prisma.channelAccount.count({
      where: { companyId, status: { not: 'DISCONNECTED' } },
    });
  },

  /** AI requests recorded in the current calendar (UTC) month. */
  async monthlyAiRequestCount(
    companyId: string,
    now: Date = new Date(),
  ): Promise<number> {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const agg = await prisma.aIUsageDaily.aggregate({
      where: { companyId, date: { gte: start, lt: end } },
      _sum: { requestCount: true },
    });
    return agg._sum.requestCount ?? 0;
  },
};
