import type { Company, User } from '@prisma/client';
import { authRepository } from './auth.repository';
import type { LoginInput, RegisterInput } from './auth.validation';
import type {
  AuthResult,
  AuthTokens,
  PublicUser,
} from './auth.types';
import { hashPassword, verifyPassword } from '../../utils/password';
import { slugify, withRandomSuffix } from '../../utils/slug';
import {
  generateTokenId,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../utils/jwt';
import { durationToMs } from '../../utils/duration';
import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';

/** Strip the password hash before exposing a user to the client. */
function toPublicUser(user: User): PublicUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, ...rest } = user;
  return rest;
}

/**
 * Derive a unique company slug from the company name, appending a random
 * suffix on collision (a few attempts, then a guaranteed-unique fallback).
 */
async function generateUniqueSlug(companyName: string): Promise<string> {
  const base = slugify(companyName);

  if (!(await authRepository.companySlugExists(base))) {
    return base;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = withRandomSuffix(base);
    if (!(await authRepository.companySlugExists(candidate))) {
      return candidate;
    }
  }

  // Extremely unlikely fallback with extra entropy.
  return withRandomSuffix(withRandomSuffix(base));
}

/**
 * Issue a fresh access/refresh token pair and persist the hashed refresh
 * token so it can later be validated, rotated, or revoked.
 */
async function issueTokens(user: User): Promise<AuthTokens> {
  const accessToken = signAccessToken({
    sub: user.id,
    companyId: user.companyId,
    role: user.role,
  });

  const jti = generateTokenId();
  const refreshToken = signRefreshToken({ sub: user.id, jti });

  await authRepository.createRefreshToken({
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + durationToMs(env.JWT_REFRESH_EXPIRES_IN)),
  });

  return { accessToken, refreshToken };
}

export const authService = {
  /** Register a new company; the first user becomes its OWNER. */
  async register(input: RegisterInput): Promise<AuthResult> {
    const existing = await authRepository.findUserByEmail(input.email);
    if (existing) {
      throw AppError.conflict('An account with this email already exists', [
        { field: 'email', message: 'Email is already in use' },
      ]);
    }

    const slug = await generateUniqueSlug(input.companyName);
    const passwordHash = await hashPassword(input.password);

    const { company, user } = await authRepository.createCompanyWithOwner({
      companyName: input.companyName,
      slug,
      fullName: input.fullName,
      email: input.email,
      passwordHash,
    });

    const tokens = await issueTokens(user);

    return { user: toPublicUser(user), company, tokens };
  },

  /** Authenticate with email + password. */
  async login(input: LoginInput): Promise<AuthResult> {
    const user = await authRepository.findUserByEmail(input.email);

    // Same generic message whether the email is unknown or the password is
    // wrong, to avoid leaking which emails are registered.
    const invalid = AppError.unauthorized('Invalid email or password');

    if (!user) {
      // Still run a hash comparison to reduce timing side-channels.
      await verifyPassword(input.password, await getDummyHash());
      throw invalid;
    }

    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) throw invalid;

    if (user.status !== 'ACTIVE') {
      throw AppError.forbidden('This account has been disabled');
    }

    const company = await authRepository.findCompanyById(user.companyId);
    if (!company) {
      throw AppError.internal();
    }
    if (company.status !== 'ACTIVE') {
      throw AppError.forbidden('This company account is suspended');
    }

    const tokens = await issueTokens(user);
    return { user: toPublicUser(user), company, tokens };
  },

  /**
   * Rotate a refresh token: validate the presented token, revoke it, and issue
   * a new pair. Reuse of an already-revoked/expired token is rejected.
   */
  async refresh(rawToken: string): Promise<AuthResult> {
    const payload = verifyRefreshToken(rawToken);

    const stored = await authRepository.findRefreshTokenByHash(
      hashToken(rawToken),
    );

    if (!stored || stored.userId !== payload.sub) {
      throw AppError.unauthorized('Invalid refresh token');
    }
    if (stored.revokedAt) {
      throw AppError.unauthorized('Refresh token has been revoked');
    }
    if (stored.expiresAt.getTime() < Date.now()) {
      throw AppError.unauthorized('Refresh token has expired');
    }

    const user = await authRepository.findUserById(payload.sub);
    if (!user || user.status !== 'ACTIVE') {
      throw AppError.unauthorized('Account is not active');
    }
    if (user.company.status !== 'ACTIVE') {
      throw AppError.forbidden('Company is not active');
    }

    // Rotation: invalidate the old token before issuing the new one.
    await authRepository.revokeRefreshToken(stored.id);
    const tokens = await issueTokens(user);

    return { user: toPublicUser(user), company: user.company, tokens };
  },

  /** Revoke the presented refresh token (idempotent-ish logout). */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;

    const stored = await authRepository.findRefreshTokenByHash(
      hashToken(rawToken),
    );
    if (stored && !stored.revokedAt) {
      await authRepository.revokeRefreshToken(stored.id);
    }
  },

  /** Load the authenticated user's profile and company. */
  async getMe(
    userId: string,
  ): Promise<{ user: PublicUser; company: Company }> {
    const user = await authRepository.findUserById(userId);
    if (!user) {
      throw AppError.notFound('User not found');
    }
    return { user: toPublicUser(user), company: user.company };
  },
};

// A real bcrypt hash of a random placeholder, computed once and reused only to
// equalize login timing when the email does not exist. It never matches any
// real password.
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword('timing-equalizer-not-a-real-password');
  }
  return dummyHashPromise;
}
