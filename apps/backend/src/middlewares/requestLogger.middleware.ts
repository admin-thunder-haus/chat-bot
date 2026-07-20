import type { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger';

/** Log method, path, status and duration for each completed request. */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    logger.info('request', {
      requestId: req.requestId,
      method: req.method,
      // Log the path only (drop the query string) so query-param values — e.g. a
      // webhook verification token — are never written to logs.
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
    });
  });

  next();
}
