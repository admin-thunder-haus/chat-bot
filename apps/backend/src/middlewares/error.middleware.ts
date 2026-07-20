import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { AppError, type AppErrorDetail } from '../utils/AppError';
import { sendError } from '../utils/apiResponse';
import { logger } from '../utils/logger';

interface NormalizedError {
  statusCode: number;
  message: string;
  errors: AppErrorDetail[];
  isOperational: boolean;
}

function normalize(err: unknown): NormalizedError {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      message: err.message,
      errors: err.errors,
      isOperational: err.isOperational,
    };
  }

  if (err instanceof ZodError) {
    return {
      statusCode: 400,
      message: 'Validation failed',
      errors: err.issues.map((i) => ({
        field: i.path.join('.') || undefined,
        message: i.message,
      })),
      isOperational: true,
    };
  }

  if (err instanceof TokenExpiredError) {
    return {
      statusCode: 401,
      message: 'Token has expired',
      errors: [],
      isOperational: true,
    };
  }

  if (err instanceof JsonWebTokenError) {
    return {
      statusCode: 401,
      message: 'Invalid token',
      errors: [],
      isOperational: true,
    };
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002: unique constraint violation (e.g. duplicate email).
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[] | undefined)?.join(', ');
      return {
        statusCode: 409,
        message: target
          ? `A record with this ${target} already exists`
          : 'Duplicate value violates a unique constraint',
        errors: [],
        isOperational: true,
      };
    }
    // P2025: record not found for an update/delete.
    if (err.code === 'P2025') {
      return {
        statusCode: 404,
        message: 'Requested record was not found',
        errors: [],
        isOperational: true,
      };
    }
    return {
      statusCode: 400,
      message: 'Database request error',
      errors: [],
      isOperational: true,
    };
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    return {
      statusCode: 400,
      message: 'Invalid database query',
      errors: [],
      isOperational: true,
    };
  }

  // Unknown / unexpected error.
  return {
    statusCode: 500,
    message: 'Internal server error',
    errors: [],
    isOperational: false,
  };
}

/**
 * Centralized error handler. Must be registered last, after all routes.
 * Produces the consistent error response shape and never leaks stack traces
 * in production.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const normalized = normalize(err);

  // Log unexpected/non-operational errors with full detail for debugging.
  if (!normalized.isOperational || normalized.statusCode >= 500) {
    logger.error('unhandled error', {
      requestId: req.requestId,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }

  sendError(
    res,
    normalized.message,
    normalized.statusCode,
    normalized.errors,
    req.requestId,
  );
}
