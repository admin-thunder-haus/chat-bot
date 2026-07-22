import type { Response } from 'express';
import type { AppErrorDetail } from './AppError';

export interface SuccessBody<T> {
  success: true;
  message: string;
  data: T;
}

export interface ErrorBody {
  success: false;
  message: string;
  errors: AppErrorDetail[];
  requestId: string;
  /** Machine-readable discriminator for errors clients must branch on. */
  code?: string;
}

/** Send a consistent success response. */
export function sendSuccess<T>(
  res: Response,
  data: T,
  message = 'Operation completed successfully',
  statusCode = 200,
): Response<SuccessBody<T>> {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

/** Send a consistent error response. */
export function sendError(
  res: Response,
  message: string,
  statusCode = 500,
  errors: AppErrorDetail[] = [],
  requestId = '',
  code?: string,
): Response<ErrorBody> {
  return res.status(statusCode).json({
    success: false,
    message,
    errors,
    requestId,
    ...(code ? { code } : {}),
  });
}
