import type {
  Company,
  EmailVerificationCode,
  Prisma,
  RefreshToken,
  User,
} from '@prisma/client';
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
    emailVerifiedAt?: Date | null;
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
          emailVerifiedAt: input.emailVerifiedAt ?? null,
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

  // --- Email verification codes ---

  /**
   * Replace any outstanding code with a fresh one: previous unconsumed codes
   * are removed so exactly one code is valid per user at a time.
   */
  async replaceVerificationCode(input: {
    userId: string;
    codeHash: string;
    expiresAt: Date;
  }): Promise<EmailVerificationCode> {
    return prisma.$transaction(async (tx) => {
      await tx.emailVerificationCode.deleteMany({
        where: { userId: input.userId, consumedAt: null },
      });
      return tx.emailVerificationCode.create({ data: input });
    });
  },

  /** Most recent unconsumed code for a user (may be expired). */
  findActiveVerificationCode(
    userId: string,
  ): Promise<EmailVerificationCode | null> {
    return prisma.emailVerificationCode.findFirst({
      where: { userId, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  },

  /** Most recent code regardless of state — used for resend cooldowns. */
  findLatestVerificationCode(
    userId: string,
  ): Promise<EmailVerificationCode | null> {
    return prisma.emailVerificationCode.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  },

  async incrementVerificationAttempts(id: string): Promise<void> {
    await prisma.emailVerificationCode.update({
      where: { id },
      data: { attemptCount: { increment: 1 } },
    });
  },

  /** Consume the code and mark the user verified in one transaction. */
  async consumeVerificationCode(input: {
    codeId: string;
    userId: string;
  }): Promise<User> {
    const [, user] = await prisma.$transaction([
      prisma.emailVerificationCode.update({
        where: { id: input.codeId },
        data: { consumedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: input.userId },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);
    return user;
  },
};
