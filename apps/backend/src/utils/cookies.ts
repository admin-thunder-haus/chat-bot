import type { CookieOptions, Response } from 'express';
import { env } from '../config/env';
import { durationToMs } from './duration';

export const REFRESH_COOKIE_NAME = 'refreshToken';

/**
 * Cookie options for the refresh token. httpOnly so JS can't read it, and
 * scoped to the refresh/logout paths. Secure + SameSite come from env so local
 * HTTP dev works while production can be locked down.
 */
function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    path: '/api/v1/auth',
    maxAge: durationToMs(env.JWT_REFRESH_EXPIRES_IN),
  };
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions());
}

export function clearRefreshCookie(res: Response): void {
  // maxAge must be omitted when clearing; keep the other attributes matching.
  const { maxAge: _maxAge, ...opts } = refreshCookieOptions();
  res.clearCookie(REFRESH_COOKIE_NAME, opts);
}
