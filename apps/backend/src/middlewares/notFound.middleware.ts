import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError';

/** Catch-all for unmatched routes; forwards a 404 to the error handler. */
export function notFound(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}
