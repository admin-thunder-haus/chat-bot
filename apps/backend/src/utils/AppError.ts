/**
 * Application-level error carrying an HTTP status code and optional
 * structured error details. Thrown anywhere in the app and translated to a
 * consistent response by the central error handler.
 */
export interface AppErrorDetail {
  field?: string;
  message: string;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errors: AppErrorDetail[];
  // Distinguishes expected/operational errors from unexpected bugs.
  public readonly isOperational: boolean;
  // Optional machine-readable discriminator (e.g. 'EMAIL_NOT_VERIFIED') so
  // clients can branch on a stable value instead of the human message.
  public readonly code?: string;

  constructor(
    message: string,
    statusCode = 500,
    errors: AppErrorDetail[] = [],
    isOperational = true,
    code?: string,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.errors = errors;
    this.isOperational = isOperational;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(
    message: string,
    errors: AppErrorDetail[] = [],
    code?: string,
  ): AppError {
    return new AppError(message, 400, errors, true, code);
  }

  static unauthorized(message = 'Unauthorized'): AppError {
    return new AppError(message, 401);
  }

  static forbidden(message = 'Forbidden', code?: string): AppError {
    return new AppError(message, 403, [], true, code);
  }

  static notFound(message = 'Resource not found'): AppError {
    return new AppError(message, 404);
  }

  static conflict(
    message: string,
    errors: AppErrorDetail[] = [],
    code?: string,
  ): AppError {
    return new AppError(message, 409, errors, true, code);
  }

  static internal(message = 'Internal server error'): AppError {
    return new AppError(message, 500, [], false);
  }
}
