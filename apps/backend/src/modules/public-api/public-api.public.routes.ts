import { Router } from 'express';
import { publicApiController } from './public-api.controller';
import {
  authenticateApiKey,
  requireScope,
} from './api-key-auth.middleware';
import { publicListQuerySchema } from './public-api.validation';
import { uuidParam } from '../../validations/common.validation';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Third-party public API (v1). Mounted at /api/public/v1 in app.ts with its
 * own rate limiter and NO JWT — authentication is an API key
 * (`Authorization: Bearer ak_live_…`), and every read is scoped to the key's
 * company.
 */
const router = Router();
const conversationIdParam = uuidParam('conversationId');

router.use(authenticateApiKey);
router.use(requireScope('read'));

router.get('/me', asyncHandler(publicApiController.me));

router.get(
  '/conversations',
  validate({ query: publicListQuerySchema }),
  asyncHandler(publicApiController.listConversations),
);

router.get(
  '/conversations/:conversationId',
  validate({ params: conversationIdParam }),
  asyncHandler(publicApiController.getConversation),
);

router.get(
  '/customers',
  validate({ query: publicListQuerySchema }),
  asyncHandler(publicApiController.listCustomers),
);

export const publicApiRoutes = router;
