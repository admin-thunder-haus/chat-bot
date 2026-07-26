import { Router } from 'express';
import { authController } from './auth.controller';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from './auth.validation';
import { validate } from '../../middlewares/validate.middleware';
import { authenticate } from '../../middlewares/auth.middleware';
import {
  authRateLimiter,
  refreshRateLimiter,
} from '../../middlewares/rateLimit.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

// Login & register carry the strict auth limiter (brute-force / signup abuse).
router.post(
  '/register',
  authRateLimiter,
  validate({ body: registerSchema }),
  asyncHandler(authController.register),
);

router.post(
  '/login',
  authRateLimiter,
  validate({ body: loginSchema }),
  asyncHandler(authController.login),
);

// Email verification: both share the strict auth limiter (code brute-force /
// mail-flood abuse), plus service-level attempt caps and resend cooldowns.
router.post(
  '/verify-email',
  authRateLimiter,
  validate({ body: verifyEmailSchema }),
  asyncHandler(authController.verifyEmail),
);

router.post(
  '/resend-verification',
  authRateLimiter,
  validate({ body: resendVerificationSchema }),
  asyncHandler(authController.resendVerification),
);

// Password reset: the strict auth limiter on both halves. Requesting a link is
// an unauthenticated email trigger (flood abuse) and consuming one is a token
// guess — the service adds a per-account cooldown and a one-hour TTL.
router.post(
  '/forgot-password',
  authRateLimiter,
  validate({ body: forgotPasswordSchema }),
  asyncHandler(authController.forgotPassword),
);

router.post(
  '/reset-password',
  authRateLimiter,
  validate({ body: resetPasswordSchema }),
  asyncHandler(authController.resetPassword),
);

// Refresh uses its OWN, more generous limiter so routine token rotation never
// exhausts the login budget (root cause of the earlier 429 storm).
router.post(
  '/refresh',
  refreshRateLimiter,
  validate({ body: refreshSchema }),
  asyncHandler(authController.refresh),
);

router.post('/logout', asyncHandler(authController.logout));

router.get('/me', authenticate, asyncHandler(authController.me));

export const authRoutes = router;
