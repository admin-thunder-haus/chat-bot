import { Router } from 'express';
import { publicApiManagementController } from './public-api.controller';
import {
  createApiKeySchema,
  createWebhookSchema,
  updateWebhookSchema,
} from './public-api.validation';
import { uuidParam } from '../../validations/common.validation';
import {
  authenticate,
  authorizeRoles,
} from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Dashboard management for the public-API surface: API keys + outbound
 * webhooks. Mounted at /api/v1/integrations. Everything is OWNER/ADMIN — these
 * objects grant programmatic access to company data.
 */
const router = Router();
const apiKeyIdParam = uuidParam('apiKeyId');
const webhookIdParam = uuidParam('webhookId');

router.use(authenticate);
router.use(authorizeRoles('OWNER', 'ADMIN'));

// --- API keys ---
router.post(
  '/api-keys',
  validate({ body: createApiKeySchema }),
  asyncHandler(publicApiManagementController.createApiKey),
);
router.get('/api-keys', asyncHandler(publicApiManagementController.listApiKeys));
router.delete(
  '/api-keys/:apiKeyId',
  validate({ params: apiKeyIdParam }),
  asyncHandler(publicApiManagementController.revokeApiKey),
);

// --- Outbound webhooks ---
router.post(
  '/webhooks',
  validate({ body: createWebhookSchema }),
  asyncHandler(publicApiManagementController.createWebhook),
);
router.get('/webhooks', asyncHandler(publicApiManagementController.listWebhooks));
router.get(
  '/webhooks/:webhookId/deliveries',
  validate({ params: webhookIdParam }),
  asyncHandler(publicApiManagementController.listWebhookDeliveries),
);
router.patch(
  '/webhooks/:webhookId',
  validate({ params: webhookIdParam, body: updateWebhookSchema }),
  asyncHandler(publicApiManagementController.updateWebhook),
);
router.delete(
  '/webhooks/:webhookId',
  validate({ params: webhookIdParam }),
  asyncHandler(publicApiManagementController.removeWebhook),
);

export const publicApiManagementRoutes = router;
