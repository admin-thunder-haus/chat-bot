import { Router } from 'express';
import { webhookController } from './webhook.controller';
import { webhookParamsSchema } from './webhook.validation';
import { validate } from '../../../middlewares/validate.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';

/**
 * Public webhook engine. NO JWT — real platforms cannot send bearer tokens.
 * Security is enforced by the provider: GET verifies a challenge token, POST
 * validates a signature over the raw body BEFORE any payload is trusted.
 *
 * Mounted in app.ts with a DEDICATED webhook rate limiter (separate budget from
 * the dashboard/API limiters), ahead of the general /api limiter.
 */
const router = Router();

router.get(
  '/:providerKey/:channelAccountId',
  validate({ params: webhookParamsSchema }),
  asyncHandler(webhookController.verify),
);

router.post(
  '/:providerKey/:channelAccountId',
  validate({ params: webhookParamsSchema }),
  asyncHandler(webhookController.receive),
);

export const webhookRoutes = router;
