import { Router } from 'express';
import { notificationsController } from './notifications.controller';
import { notificationListQuerySchema } from './notifications.validation';
import { uuidParam } from '../../validations/common.validation';
import { authenticate } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();
const notificationIdParam = uuidParam('notificationId');

// Every endpoint is available to any authenticated role — notifications are
// per-company (visibility rules live in the repository).
router.use(authenticate);

router.get(
  '/',
  validate({ query: notificationListQuerySchema }),
  asyncHandler(notificationsController.list),
);

router.get('/unread-count', asyncHandler(notificationsController.unreadCount));

router.post('/read-all', asyncHandler(notificationsController.markAllRead));

router.patch(
  '/:notificationId/read',
  validate({ params: notificationIdParam }),
  asyncHandler(notificationsController.markRead),
);

export const notificationsRoutes = router;
