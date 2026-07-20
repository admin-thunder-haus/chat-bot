import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { env, isTest } from '../config/env';
import { sendError } from '../utils/apiResponse';

/**
 * Shared handler so rate-limit rejections use the standard API error shape.
 * express-rate-limit sets the `RateLimit-*` and `Retry-After` headers before
 * this runs (standardHeaders: true), so clients still get backoff hints.
 */
const rateLimitHandler = (req: Request, res: Response): void => {
  sendError(
    res,
    'Too many requests, please try again later',
    429,
    [],
    req.requestId,
  );
};

interface LimiterConfig {
  windowMs: number;
  max: number;
  /** Skip while NODE_ENV=test (default true) so the functional suite isn't throttled. */
  skipInTest?: boolean;
}

/**
 * Factory for a rate limiter with our shared conventions:
 * - Standard `RateLimit-*` + `Retry-After` headers, no legacy headers.
 * - CORS preflight (OPTIONS) never consumes quota.
 * - Health probes never consume quota (avoids false failures from monitors).
 * - Consistent error body via the central response helper.
 */
export function createRateLimiter({
  windowMs,
  max,
  skipInTest = true,
}: LimiterConfig): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    skip: (req) => {
      if (req.method === 'OPTIONS') return true;
      if (req.originalUrl.includes('/health')) return true;
      if (skipInTest && isTest) return true;
      return false;
    },
  });
}

/** Global limiter applied to all API routes. */
export const apiRateLimiter = createRateLimiter({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
});

/** Strict limiter for login/register (brute-force + signup-abuse protection). */
export const authRateLimiter = createRateLimiter({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
});

/** Dedicated limiter for token refresh — separate budget from login. */
export const refreshRateLimiter = createRateLimiter({
  windowMs: env.REFRESH_RATE_LIMIT_WINDOW_MS,
  max: env.REFRESH_RATE_LIMIT_MAX,
});

/** Dedicated limiter for AI endpoints (provider calls are expensive). */
export const aiRateLimiter = createRateLimiter({
  windowMs: env.AI_RATE_LIMIT_WINDOW_MS,
  max: env.AI_RATE_LIMIT_MAX,
});

/**
 * Dedicated limiter for the public webhook engine — a separate budget from the
 * dashboard/API limiters so provider traffic never starves (or is starved by)
 * normal app usage.
 */
export const webhookRateLimiter = createRateLimiter({
  windowMs: env.WEBHOOK_RATE_LIMIT_WINDOW_MS,
  max: env.WEBHOOK_RATE_LIMIT_MAX,
});

/**
 * Dedicated limiter for the public Web Chat widget API — its own budget so a
 * busy widget never consumes the dashboard/API quota (and vice versa). Sized for
 * polling: visitors poll for new messages while the widget is open.
 */
export const widgetRateLimiter = createRateLimiter({
  windowMs: env.WIDGET_RATE_LIMIT_WINDOW_MS,
  max: env.WIDGET_RATE_LIMIT_MAX,
});
