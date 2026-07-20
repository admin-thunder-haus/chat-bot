import { Router } from 'express';
import { messagesController } from './messages.controller';
import {
  messageListQuerySchema,
  sendMessageSchema,
} from './messages.validation';
import { uuidParam } from '../../validations/common.validation';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

// mergeParams so :conversationId from the parent mount is available.
const router = Router({ mergeParams: true });
const convParam = uuidParam('conversationId');

router.get(
  '/',
  validate({ params: convParam, query: messageListQuerySchema }),
  asyncHandler(messagesController.list),
);

// Any authenticated role may reply (AGENT included, per the role matrix).
router.post(
  '/',
  validate({ params: convParam, body: sendMessageSchema }),
  asyncHandler(messagesController.send),
);

export const messagesRoutes = router;
