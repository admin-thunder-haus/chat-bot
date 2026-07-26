import type { LoginAuditEvent, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';

/**
 * Data-access layer for the login audit trail. Split out of auth.repository so
 * the audit table has exactly one owner: nothing else in the codebase may write
 * it, and the read is expressible in one place as "this user's own rows only".
 */
export const loginAuditRepository = {
  create(
    data: Prisma.LoginAuditEventUncheckedCreateInput,
  ): Promise<LoginAuditEvent> {
    return prisma.loginAuditEvent.create({ data });
  },

  /**
   * A single user's most recent attempts, newest first. BOTH `companyId` and
   * `userId` are filtered even though `userId` alone is unique: the row also
   * carries the tenant, and a leak here would be a cross-tenant leak, so the
   * tenant predicate is stated rather than implied. Hits the
   * (userId, createdAt) index.
   */
  findRecentForUser(input: {
    companyId: string;
    userId: string;
    limit: number;
  }): Promise<LoginAuditEvent[]> {
    return prisma.loginAuditEvent.findMany({
      where: { companyId: input.companyId, userId: input.userId },
      orderBy: { createdAt: 'desc' },
      take: input.limit,
    });
  },

  /** Delete every row older than `cutoff`. Returns how many went. */
  async deleteOlderThan(cutoff: Date): Promise<number> {
    const { count } = await prisma.loginAuditEvent.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return count;
  },
};
