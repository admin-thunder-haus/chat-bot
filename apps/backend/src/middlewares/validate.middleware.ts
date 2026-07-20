import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { AppError } from '../utils/AppError';

/**
 * Shape of a request validation schema. Any subset of body/params/query may be
 * validated; the parsed (and coerced) values replace the originals so handlers
 * receive clean, typed data.
 */
export interface RequestSchemas {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}

function toDetails(error: ZodError) {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || undefined,
    message: issue.message,
  }));
}

/**
 * Validate request parts against the given Zod schemas. On failure a 400
 * AppError is produced with field-level details (no internal details leaked).
 */
export function validate(schemas: RequestSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      if (schemas.query) {
        // req.query is a getter in Express 5-style setups; assign defensively.
        Object.assign(req.query, schemas.query.parse(req.query));
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(AppError.badRequest('Validation failed', toDetails(err)));
        return;
      }
      next(err);
    }
  };
}
