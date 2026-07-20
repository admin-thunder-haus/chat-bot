import { Router } from 'express';
import { channelsController } from './channels.controller';
import {
  channelListQuerySchema,
  channelStatusSchema,
  createChannelAccountSchema,
  deliveryRetryParamsSchema,
  updateChannelAccountSchema,
  webChatConfigSchema,
  whatsAppConnectSchema,
} from './channels.validation';
import { uuidParam } from '../../validations/common.validation';
import { authenticate, authorizeRoles } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();
// OWNER + ADMIN manage channels; AGENT is read-only (view providers/accounts).
const manageRoles = authorizeRoles('OWNER', 'ADMIN');
const channelIdParam = uuidParam('channelAccountId');

router.use(authenticate);

// Provider catalog (all roles).
router.get('/providers', asyncHandler(channelsController.listProviders));

// WhatsApp connect (credentialed) — OWNER/ADMIN. Registered before the
// `/:channelAccountId` param routes so the literal path always wins.
router.post(
  '/whatsapp/connect',
  manageRoles,
  validate({ body: whatsAppConnectSchema }),
  asyncHandler(channelsController.connectWhatsApp),
);

// Channel accounts (list/get: all roles; writes: OWNER/ADMIN).
router.get(
  '/',
  validate({ query: channelListQuerySchema }),
  asyncHandler(channelsController.list),
);

router.post(
  '/',
  manageRoles,
  validate({ body: createChannelAccountSchema }),
  asyncHandler(channelsController.create),
);

router.get(
  '/:channelAccountId',
  validate({ params: channelIdParam }),
  asyncHandler(channelsController.getOne),
);

router.patch(
  '/:channelAccountId',
  manageRoles,
  validate({ params: channelIdParam, body: updateChannelAccountSchema }),
  asyncHandler(channelsController.update),
);

router.patch(
  '/:channelAccountId/status',
  manageRoles,
  validate({ params: channelIdParam, body: channelStatusSchema }),
  asyncHandler(channelsController.setStatus),
);

router.delete(
  '/:channelAccountId',
  manageRoles,
  validate({ params: channelIdParam }),
  asyncHandler(channelsController.remove),
);

router.post(
  '/:channelAccountId/health-check',
  manageRoles,
  validate({ params: channelIdParam }),
  asyncHandler(channelsController.healthCheck),
);

// Web Chat widget config (view: all roles; edit: OWNER/ADMIN).
router.get(
  '/:channelAccountId/widget-config',
  validate({ params: channelIdParam }),
  asyncHandler(channelsController.getWidgetConfig),
);
router.patch(
  '/:channelAccountId/widget-config',
  manageRoles,
  validate({ params: channelIdParam, body: webChatConfigSchema }),
  asyncHandler(channelsController.updateWidgetConfig),
);

// Safe monitoring diagnostics (all roles — read-only, no credentials).
router.get(
  '/:channelAccountId/diagnostics',
  validate({ params: channelIdParam }),
  asyncHandler(channelsController.diagnostics),
);

// Manual delivery retry (failure recovery) — OWNER/ADMIN only.
router.post(
  '/:channelAccountId/deliveries/:deliveryId/retry',
  manageRoles,
  validate({ params: deliveryRetryParamsSchema }),
  asyncHandler(channelsController.retryDelivery),
);

export const channelsRoutes = router;
