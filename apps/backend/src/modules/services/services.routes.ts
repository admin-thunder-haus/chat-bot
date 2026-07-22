import { Router } from 'express';
import { servicesController } from './services.controller';
import {
  createServiceSchema,
  importCommitSchema,
  reorderSchema,
  serviceListQuerySchema,
  serviceStatusSchema,
  updateServiceSchema,
} from './services.validation';
import { uuidParam } from '../../validations/common.validation';
import { authenticate, authorizeRoles } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { uploadExcelFile } from '../../middlewares/upload.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();
const writeRoles = authorizeRoles('OWNER', 'ADMIN');
const serviceIdParam = uuidParam('serviceId');

router.use(authenticate);

// Reads — available to any authenticated role.
router.get(
  '/',
  validate({ query: serviceListQuerySchema }),
  asyncHandler(servicesController.list),
);

// Writes — OWNER / ADMIN only. `/reorder` is declared before `/:serviceId`
// so the literal path is not swallowed by the param route.
router.post(
  '/',
  writeRoles,
  validate({ body: createServiceSchema }),
  asyncHandler(servicesController.create),
);

router.patch(
  '/reorder',
  writeRoles,
  validate({ body: reorderSchema }),
  asyncHandler(servicesController.reorder),
);

// Excel import. Multipart upload ("file" field) parsed in memory; preview
// never writes, commit re-validates everything server-side. Declared before
// `/:serviceId` so the literal paths win.
router.post(
  '/import/preview',
  writeRoles,
  uploadExcelFile,
  asyncHandler(servicesController.importPreview),
);

router.post(
  '/import',
  writeRoles,
  uploadExcelFile,
  validate({ body: importCommitSchema }),
  asyncHandler(servicesController.importCommit),
);

router.get(
  '/:serviceId',
  validate({ params: serviceIdParam }),
  asyncHandler(servicesController.getOne),
);

router.patch(
  '/:serviceId/status',
  writeRoles,
  validate({ params: serviceIdParam, body: serviceStatusSchema }),
  asyncHandler(servicesController.setStatus),
);

router.patch(
  '/:serviceId',
  writeRoles,
  validate({ params: serviceIdParam, body: updateServiceSchema }),
  asyncHandler(servicesController.update),
);

router.delete(
  '/:serviceId',
  writeRoles,
  validate({ params: serviceIdParam }),
  asyncHandler(servicesController.remove),
);

export const servicesRoutes = router;
