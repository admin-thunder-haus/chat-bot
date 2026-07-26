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

  /**
   * HARD-delete a tenant. Every model carrying `companyId` declares
   * `onDelete: Cascade` on its company relation (and the per-user tables
   * cascade from User), so a single delete removes the whole tree in one
   * transaction — the database, not application code, guarantees completeness.
   *
   * That is deliberate: a hand-written list of `deleteMany` calls silently
   * misses whatever model is added next, leaving orphaned tenant data behind.
   * `tests/company-deletion.test.ts` proves it by walking EVERY table after a
   * delete instead of trusting this comment.
   */
  async hardDelete(id: string): Promise<void> {
    await prisma.company.delete({ where: { id } });
  },
};
