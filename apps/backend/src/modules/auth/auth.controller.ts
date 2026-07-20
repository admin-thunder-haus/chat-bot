import type { Request, Response } from 'express';
import { authService } from './auth.service';
import { sendSuccess } from '../../utils/apiResponse';
import { AppError } from '../../utils/AppError';
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookie,
  setRefreshCookie,
} from '../../utils/cookies';
import type { AuthResult } from './auth.types';

/**
 * Build the client-facing auth payload. The refresh token is delivered via an
 * httpOnly cookie (set separately); it is also included in the body so
 * non-browser API clients can use it, but browser clients should ignore it.
 */
function authPayload(result: AuthResult) {
  return {
    user: result.user,
    company: result.company,
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
  };
}

/** Read the refresh token from cookie first, then body fallback. */
function extractRefreshToken(req: Request): string | undefined {
  const fromCookie = req.cookies?.[REFRESH_COOKIE_NAME];
  if (typeof fromCookie === 'string' && fromCookie.length > 0) {
    return fromCookie;
  }
  const fromBody = req.body?.refreshToken;
  return typeof fromBody === 'string' && fromBody.length > 0
    ? fromBody
    : undefined;
}

export const authController = {
  async register(req: Request, res: Response): Promise<void> {
    const result = await authService.register(req.body);
    setRefreshCookie(res, result.tokens.refreshToken);
    sendSuccess(res, authPayload(result), 'Company registered successfully', 201);
  },

  async login(req: Request, res: Response): Promise<void> {
    const result = await authService.login(req.body);
    setRefreshCookie(res, result.tokens.refreshToken);
    sendSuccess(res, authPayload(result), 'Logged in successfully');
  },

  async refresh(req: Request, res: Response): Promise<void> {
    const rawToken = extractRefreshToken(req);
    if (!rawToken) {
      throw AppError.unauthorized('No refresh token provided');
    }
    const result = await authService.refresh(rawToken);
    setRefreshCookie(res, result.tokens.refreshToken);
    sendSuccess(res, authPayload(result), 'Token refreshed successfully');
  },

  async logout(req: Request, res: Response): Promise<void> {
    const rawToken = extractRefreshToken(req);
    await authService.logout(rawToken);
    clearRefreshCookie(res);
    sendSuccess(res, null, 'Logged out successfully');
  },

  async me(req: Request, res: Response): Promise<void> {
    // req.user is guaranteed by the authenticate middleware.
    const { id } = req.user!;
    const result = await authService.getMe(id);
    sendSuccess(res, result, 'Current user fetched successfully');
  },
};
