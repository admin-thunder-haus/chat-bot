import crypto from 'node:crypto';
import type { Company, User } from '@prisma/client';
import { authRepository } from './auth.repository';
import type {
  LoginInput,
  RegisterInput,
  ResendVerificationInput,
  VerifyEmailInput,
} from './auth.validation';
import type {
  AuthResult,
  AuthTokens,
  PublicUser,
  RegisterResult,
} from './auth.types';
import { mailer } from '../../utils/mailer';
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
import { env, isEmailVerificationEnabled } from '../../config/env';
import { AppError } from '../../utils/AppError';
import { billingService } from '../billing/billing.service';

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

/**
 * Generate a 6-digit verification code, persist its hash (replacing any
 * outstanding code), and email it to the user.
 */
async function issueVerificationCode(user: User): Promise<void> {
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

  await authRepository.replaceVerificationCode({
    userId: user.id,
    codeHash: hashToken(code),
    expiresAt: new Date(Date.now() + env.EMAIL_VERIFICATION_CODE_TTL_MS),
  });

  await mailer.sendVerificationEmail({
    to: user.email,
    fullName: user.fullName,
    code,
  });
}

export const authService = {
  /**
   * Register a new company; the first user becomes its OWNER. While email
   * verification is enforced, no tokens are issued — the user must confirm
   * the emailed 6-digit code (verifyEmail) before they can log in.
   */
  async register(input: RegisterInput): Promise<RegisterResult> {
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
      // When verification is disabled, accounts are born verified so a later
      // enable never locks them out.
      emailVerifiedAt: isEmailVerificationEnabled ? null : new Date(),
    });

    // Every new company starts on the free trial. This call never throws —
    // billing must not block sign-up (the subscription is also created lazily
    // on the first billing read as a safety net).
    await billingService.ensureTrialSubscription(company.id);

    if (isEmailVerificationEnabled) {
      await issueVerificationCode(user);
      return {
        user: toPublicUser(user),
        company,
        tokens: null,
        requiresEmailVerification: true,
      };
    }

    const tokens = await issueTokens(user);
    return {
      user: toPublicUser(user),
      company,
      tokens,
      requiresEmailVerification: false,
    };
  },

  /**
   * Confirm the emailed verification code. On success the user is marked
   * verified and logged in (tokens issued) so onboarding stays seamless.
   */
  async verifyEmail(input: VerifyEmailInput): Promise<AuthResult> {
    // One generic error for unknown email / wrong code / expired code, so the
    // endpoint does not leak which emails are registered.
    const invalid = AppError.badRequest(
      'Invalid or expired verification code',
    );

    const user = await authRepository.findUserByEmail(input.email);
    if (!user) throw invalid;

    if (user.emailVerifiedAt) {
      // Machine-readable code lets the client route straight to login.
      throw AppError.conflict(
        'This email is already verified. Please log in.',
        [],
        'EMAIL_ALREADY_VERIFIED',
      );
    }

    const stored = await authRepository.findActiveVerificationCode(user.id);
    if (!stored || stored.expiresAt.getTime() < Date.now()) {
      throw invalid;
    }
    if (stored.attemptCount >= env.EMAIL_VERIFICATION_MAX_ATTEMPTS) {
      throw AppError.badRequest(
        'Too many incorrect attempts. Please request a new code.',
      );
    }

    if (stored.codeHash !== hashToken(input.code)) {
      await authRepository.incrementVerificationAttempts(stored.id);
      throw invalid;
    }

    const verifiedUser = await authRepository.consumeVerificationCode({
      codeId: stored.id,
      userId: user.id,
    });

    const company = await authRepository.findCompanyById(user.companyId);
    if (!company) throw AppError.internal();

    const tokens = await issueTokens(verifiedUser);
    return { user: toPublicUser(verifiedUser), company, tokens };
  },

  /**
   * Re-send the verification code. Always resolves with a generic outcome so
   * the endpoint cannot be used to probe which emails are registered. A
   * cooldown prevents mail flooding.
   */
  async resendVerification(input: ResendVerificationInput): Promise<void> {
    const user = await authRepository.findUserByEmail(input.email);
    if (!user || user.emailVerifiedAt) return;

    const latest = await authRepository.findLatestVerificationCode(user.id);
    if (
      latest &&
      Date.now() - latest.createdAt.getTime() <
        env.EMAIL_VERIFICATION_RESEND_COOLDOWN_MS
    ) {
      // Within the cooldown window: silently skip to avoid mail flooding.
      return;
    }

    await issueVerificationCode(user);
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

    if (isEmailVerificationEnabled && !user.emailVerifiedAt) {
      throw AppError.forbidden(
        'Please verify your email address before logging in',
        'EMAIL_NOT_VERIFIED',
      );
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
