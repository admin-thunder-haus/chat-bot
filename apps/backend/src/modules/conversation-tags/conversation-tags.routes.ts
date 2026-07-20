import { Router } from 'express';
import { conversationTagsController } from './conversation-tags.controller';
import { createTagSchema, updateTagSchema } from './conversation-tags.validation';
import { uuidParam } from '../../validations/common.validation';
import { authenticate, authorizeRoles } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();
const manageRoles = authorizeRoles('OWNER', 'ADMIN');
const tagIdParam = uuidParam('tagId');

router.use(authenticate);

// Any authenticated role may view the company's tags.
router.get('/', asyncHandler(conversationTagsController.list));

// Only OWNER / ADMIN manage the global tag catalog.
router.post(
  '/',
  manageRoles,
  validate({ body: createTagSchema }),
  asyncHandler(conversationTagsController.create),
);

router.patch(
  '/:tagId',
  manageRoles,
  validate({ params: tagIdParam, body: updateTagSchema }),
  asyncHandler(conversationTagsController.update),
);

router.delete(
  '/:tagId',
  manageRoles,
  validate({ params: tagIdParam }),
  asyncHandler(conversationTagsController.remove),
);

export const conversationTagsRoutes = router;
