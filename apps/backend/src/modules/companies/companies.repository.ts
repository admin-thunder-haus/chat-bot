import type { Company, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';

/** Data-access for companies. */
export const companiesRepository = {
  findById(id: string): Promise<Company | null> {
    return prisma.company.findUnique({ where: { id } });
  },

  findBySlug(slug: string): Promise<Company | null> {
    return prisma.company.findUnique({ where: { slug } });
  },

  /** Update mutable company/profile fields. `id` is the tenant PK from the JWT. */
  updateProfile(
    id: string,
    data: Prisma.CompanyUpdateInput,
  ): Promise<Company> {
    return prisma.company.update({ where: { id }, data });
  },
};
