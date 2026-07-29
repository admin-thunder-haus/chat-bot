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

/**
 * SHARED endpoints — no account id in the URL. Declared BEFORE the per-account
 * routes so `/facebook` cannot be swallowed by `/:providerKey/:channelAccountId`.
 *
 * These exist because a Meta app has exactly ONE callback URL for every tenant
 * it serves, so with one-click connect the account cannot come from the URL;
 * it is resolved from the ids inside the payload. The per-account routes below
 * stay exactly as they were — a customer who connects manually with their own
 * Meta app keeps their own URL, and nothing about that flow changes.
 */
router.get(
  '/:providerKey',
  asyncHandler(webhookController.verifyShared),
);

router.post(
  '/:providerKey',
  asyncHandler(webhookController.receiveShared),
);

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
