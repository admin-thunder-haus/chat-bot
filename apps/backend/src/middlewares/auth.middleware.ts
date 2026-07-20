import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '@prisma/client';
import { verifyAccessToken } from '../utils/jwt';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { prisma } from '../config/prisma';

/**
 * Authentication middleware.
 * Verifies the Bearer access token, confirms the user + company are still
 * active, and attaches a typed `req.user` derived solely from the token
 * identity. companyId is taken from the token, never from the request.
 */
export const authenticate = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw AppError.unauthorized('Missing or malformed Authorization header');
    }

    const token = header.slice('Bearer '.length).trim();
    const payload = verifyAccessToken(token);

    // Re-check status so disabled users / suspended companies lose access
    // immediately, without waiting for the access token to expire.
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { company: true },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw AppError.unauthorized('Account is not active');
    }
    if (user.company.status !== 'ACTIVE') {
      throw AppError.forbidden('Company is not active');
    }

    req.user = {
      id: user.id,
      companyId: user.companyId,
      role: user.role,
    };

    next();
  },
);

/**
 * Role-based authorization guard. Use after `authenticate`.
 * Example: router.get('/x', authenticate, authorize('OWNER', 'ADMIN'), handler)
 */
export function authorize(...allowed: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw AppError.unauthorized();
    }
    if (!allowed.includes(req.user.role)) {
      throw AppError.forbidden(
        'You do not have permission to perform this action',
      );
    }
    next();
  };
}

/**
 * Alias of {@link authorize} with a more explicit name, matching the Day 2
 * convention `authorizeRoles(UserRole.OWNER, UserRole.ADMIN)`.
 */
export const authorizeRoles = authorize;
