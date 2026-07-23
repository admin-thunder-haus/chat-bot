import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { DEFAULT_PLANS } from './billing.types';

/**
 * Idempotently upsert the default plan catalog (by unique plan `code`).
 * Called once at server boot (non-fatal on failure) and lazily whenever the
 * free-trial plan is needed but missing (fresh databases, tests).
 */
export async function ensureDefaultPlans(): Promise<void> {
  for (const plan of DEFAULT_PLANS) {
    const data = {
      name: plan.name,
      description: plan.description,
      monthlyPriceUsd: plan.monthlyPriceUsd,
      yearlyPriceUsd: plan.yearlyPriceUsd,
      // PlanLimits is a closed interface; Prisma's Json input wants an
      // index signature, hence the cast (values are plain numbers/nulls).
      limits: plan.limits as unknown as Prisma.InputJsonValue,
      features: plan.features,
      isActive: true,
      sortOrder: plan.sortOrder,
    };
    await prisma.plan.upsert({
      where: { code: plan.code },
      update: data,
      create: { code: plan.code, ...data },
    });
  }
}
