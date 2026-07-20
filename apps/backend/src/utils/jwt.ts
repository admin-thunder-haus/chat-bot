import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import type { UserRole } from '@prisma/client';
import { AppError } from './AppError';

/** Payload embedded in the short-lived access token. */
export interface AccessTokenPayload {
  sub: string; // user id
  companyId: string;
  role: UserRole;
}

/** Payload embedded in the refresh token. */
export interface RefreshTokenPayload {
  sub: string; // user id
  jti: string; // unique token id, ties the JWT to a DB record
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  } as SignOptions);
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  } as SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
  } catch {
    throw AppError.unauthorized('Invalid or expired access token');
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
  } catch {
    throw AppError.unauthorized('Invalid or expired refresh token');
  }
}

/** Generate a random opaque id used as the refresh token's `jti`. */
export function generateTokenId(): string {
  return crypto.randomUUID();
}

/**
 * Hash a refresh token string before persisting it. Refresh tokens are
 * high-entropy signed JWTs, so a fast SHA-256 hash is appropriate (bcrypt is
 * reserved for low-entropy user passwords).
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
