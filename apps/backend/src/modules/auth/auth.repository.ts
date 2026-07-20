import type { Company, Prisma, RefreshToken, User } from '@prisma/client';
import { prisma } from '../../config/prisma';

/**
 * Data-access layer for auth. All Prisma queries live here so services stay
 * focused on business logic and are easy to test/mock.
 */
export const authRepository = {
  findUserByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  },

  findUserById(id: string): Promise<(User & { company: Company }) | null> {
    return prisma.user.findUnique({
      where: { id },
      include: { company: true },
    });
  },

  findCompanyById(id: string): Promise<Company | null> {
    return prisma.company.findUnique({ where: { id } });
  },

  companySlugExists(slug: string): Promise<boolean> {
    return prisma.company
      .findUnique({ where: { slug }, select: { id: true } })
      .then((c) => c !== null);
  },

  /**
   * Create a company and its OWNER user in a single transaction so a partial
   * signup can never persist.
   */
  async createCompanyWithOwner(input: {
    companyName: string;
    slug: string;
    fullName: string;
    email: string;
    passwordHash: string;
  }): Promise<{ company: Company; user: User }> {
    return prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: input.companyName,
          slug: input.slug,
          status: 'ACTIVE',
        },
      });

      const user = await tx.user.create({
        data: {
          companyId: company.id,
          fullName: input.fullName,
          email: input.email,
          passwordHash: input.passwordHash,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });

      return { company, user };
    });
  },

  createRefreshToken(
    data: Prisma.RefreshTokenUncheckedCreateInput,
  ): Promise<RefreshToken> {
    return prisma.refreshToken.create({ data });
  },

  findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    return prisma.refreshToken.findUnique({ where: { tokenHash } });
  },

  async revokeRefreshToken(id: string): Promise<void> {
    await prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  },

  /** Revoke every active refresh token for a user (used on logout-all). */
  async revokeAllUserTokens(userId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },
};
