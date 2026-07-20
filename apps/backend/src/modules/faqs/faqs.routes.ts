import { Router } from 'express';
import { faqsController } from './faqs.controller';
import {
  createFaqSchema,
  faqListQuerySchema,
  faqStatusSchema,
  reorderSchema,
  updateFaqSchema,
} from './faqs.validation';
import { uuidParam } from '../../validations/common.validation';
import { authenticate, authorizeRoles } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();
const writeRoles = authorizeRoles('OWNER', 'ADMIN');
const faqIdParam = uuidParam('faqId');

router.use(authenticate);

router.get(
  '/',
  validate({ query: faqListQuerySchema }),
  asyncHandler(faqsController.list),
);

router.post(
  '/',
  writeRoles,
  validate({ body: createFaqSchema }),
  asyncHandler(faqsController.create),
);

router.patch(
  '/reorder',
  writeRoles,
  validate({ body: reorderSchema }),
  asyncHandler(faqsController.reorder),
);

router.get(
  '/:faqId',
  validate({ params: faqIdParam }),
  asyncHandler(faqsController.getOne),
);

router.patch(
  '/:faqId/status',
  writeRoles,
  validate({ params: faqIdParam, body: faqStatusSchema }),
  asyncHandler(faqsController.setStatus),
);

router.patch(
  '/:faqId',
  writeRoles,
  validate({ params: faqIdParam, body: updateFaqSchema }),
  asyncHandler(faqsController.update),
);

router.delete(
  '/:faqId',
  writeRoles,
  validate({ params: faqIdParam }),
  asyncHandler(faqsController.remove),
);

export const faqsRoutes = router;
