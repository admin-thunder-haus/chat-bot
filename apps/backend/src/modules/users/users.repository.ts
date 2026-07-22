import type { Prisma, User } from '@prisma/client';
import { prisma } from '../../config/prisma';

// Never select passwordHash when returning users to callers.
const publicUserSelect = {
  id: true,
  companyId: true,
  fullName: true,
  email: true,
  role: true,
  status: true,
  emailVerifiedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

/**
 * Data-access for users. Every query is scoped by companyId so a tenant can
 * only ever read/modify its own users — the foundation for row isolation.
 */
export const usersRepository = {
  findManyByCompany(companyId: string): Promise<Omit<User, 'passwordHash'>[]> {
    return prisma.user.findMany({
      where: { companyId },
      select: publicUserSelect,
      orderBy: { createdAt: 'asc' },
    });
  },

  findByIdScoped(
    id: string,
    companyId: string,
  ): Promise<Omit<User, 'passwordHash'> | null> {
    return prisma.user.findFirst({
      where: { id, companyId },
      select: publicUserSelect,
    });
  },

  /** Active users of a company who can be assigned conversations. */
  findAssignable(companyId: string): Promise<Omit<User, 'passwordHash'>[]> {
    return prisma.user.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        role: { in: ['OWNER', 'ADMIN', 'AGENT'] },
      },
      select: publicUserSelect,
      orderBy: { fullName: 'asc' },
    });
  },
};
