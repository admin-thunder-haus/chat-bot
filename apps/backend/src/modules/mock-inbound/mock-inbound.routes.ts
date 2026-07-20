import { Router } from 'express';
import { mockInboundController } from './mock-inbound.controller';
import { mockInboundSchema } from './mock-inbound.validation';
import { authenticate } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import { isProduction } from '../../config/env';
import { AppError } from '../../utils/AppError';

const router = Router();

// Defense in depth: even if mounted, refuse to run in production.
router.use((_req, _res, next) => {
  if (isProduction) {
    next(AppError.notFound('Not found'));
    return;
  }
  next();
});

// Requires authentication; company is derived from the JWT (never the body).
router.post(
  '/mock-inbound-message',
  authenticate,
  validate({ body: mockInboundSchema }),
  asyncHandler(mockInboundController.create),
);

export const mockInboundRoutes = router;
