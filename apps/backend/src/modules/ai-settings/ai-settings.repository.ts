import type { CompanyAISettings, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';

/** Tenant-scoped data-access for the one-to-one AI settings row. */
export const aiSettingsRepository = {
  findByCompany(companyId: string): Promise<CompanyAISettings | null> {
    return prisma.companyAISettings.findUnique({ where: { companyId } });
  },

  upsert(
    companyId: string,
    data: Omit<Prisma.CompanyAISettingsUncheckedCreateInput, 'companyId'>,
  ): Promise<CompanyAISettings> {
    return prisma.companyAISettings.upsert({
      where: { companyId },
      create: { ...data, companyId },
      update: data,
    });
  },
};
