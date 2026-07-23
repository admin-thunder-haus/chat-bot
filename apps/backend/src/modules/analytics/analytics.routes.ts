import { Router } from 'express';
import { z } from 'zod';
import { analyticsController } from './analytics.controller';
import { authenticate } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

const aiAnalyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

router.use(authenticate);

router.get(
  '/ai',
  validate({ query: aiAnalyticsQuerySchema }),
  asyncHandler(analyticsController.ai),
);

export const analyticsRoutes = router;
