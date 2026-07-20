import { Router } from 'express';
import { knowledgeBaseController } from './knowledge-base.controller';
import {
  createKnowledgeSchema,
  knowledgeListQuerySchema,
  knowledgeStatusSchema,
  reorderSchema,
  updateKnowledgeSchema,
} from './knowledge-base.validation';
import { uuidParam } from '../../validations/common.validation';
import { authenticate, authorizeRoles } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();
const writeRoles = authorizeRoles('OWNER', 'ADMIN');
const entryIdParam = uuidParam('entryId');

router.use(authenticate);

router.get(
  '/',
  validate({ query: knowledgeListQuerySchema }),
  asyncHandler(knowledgeBaseController.list),
);

router.post(
  '/',
  writeRoles,
  validate({ body: createKnowledgeSchema }),
  asyncHandler(knowledgeBaseController.create),
);

router.patch(
  '/reorder',
  writeRoles,
  validate({ body: reorderSchema }),
  asyncHandler(knowledgeBaseController.reorder),
);

router.get(
  '/:entryId',
  validate({ params: entryIdParam }),
  asyncHandler(knowledgeBaseController.getOne),
);

router.patch(
  '/:entryId/status',
  writeRoles,
  validate({ params: entryIdParam, body: knowledgeStatusSchema }),
  asyncHandler(knowledgeBaseController.setStatus),
);

router.patch(
  '/:entryId',
  writeRoles,
  validate({ params: entryIdParam, body: updateKnowledgeSchema }),
  asyncHandler(knowledgeBaseController.update),
);

router.delete(
  '/:entryId',
  writeRoles,
  validate({ params: entryIdParam }),
  asyncHandler(knowledgeBaseController.remove),
);

export const knowledgeBaseRoutes = router;
