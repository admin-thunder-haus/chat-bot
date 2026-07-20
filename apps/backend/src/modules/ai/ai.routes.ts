import { Router } from 'express';
import { aiController } from './ai.controller';
import {
  generationsListQuerySchema,
  playgroundSchema,
} from './ai.validation';
import { uuidParam } from '../../validations/common.validation';
import { authenticate, authorizeRoles } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { aiRateLimiter } from '../../middlewares/rateLimit.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

/** Global /ai routes (usage, generations, playground). */
const router = Router();

router.use(authenticate);

// Usage + generation history — any authenticated role (tenant-scoped).
router.get('/usage', asyncHandler(aiController.usage));

router.get(
  '/generations',
  validate({ query: generationsListQuerySchema }),
  asyncHandler(aiController.listGenerations),
);

router.get(
  '/generations/:generationId',
  validate({ params: uuidParam('generationId') }),
  asyncHandler(aiController.getGeneration),
);

// Playground — OWNER/ADMIN only, AI-limited (provider calls).
router.post(
  '/playground',
  authorizeRoles('OWNER', 'ADMIN'),
  aiRateLimiter,
  validate({ body: playgroundSchema }),
  asyncHandler(aiController.playground),
);

export const aiRoutes = router;
