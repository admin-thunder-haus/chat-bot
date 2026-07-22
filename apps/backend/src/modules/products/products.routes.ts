import { Router } from 'express';
import { productsController } from './products.controller';
import {
  createProductSchema,
  importCommitSchema,
  productListQuerySchema,
  productStatusSchema,
  reorderSchema,
  updateProductSchema,
} from './products.validation';
import { uuidParam } from '../../validations/common.validation';
import { authenticate, authorizeRoles } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { uploadExcelFile } from '../../middlewares/upload.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();
const writeRoles = authorizeRoles('OWNER', 'ADMIN');
const productIdParam = uuidParam('productId');

router.use(authenticate);

// Reads — available to any authenticated role.
router.get(
  '/',
  validate({ query: productListQuerySchema }),
  asyncHandler(productsController.list),
);

// Writes — OWNER / ADMIN only. Literal paths are declared before
// `/:productId` so they are not swallowed by the param route.
router.post(
  '/',
  writeRoles,
  validate({ body: createProductSchema }),
  asyncHandler(productsController.create),
);

router.patch(
  '/reorder',
  writeRoles,
  validate({ body: reorderSchema }),
  asyncHandler(productsController.reorder),
);

// Excel import. Multipart upload ("file" field) parsed in memory; preview
// never writes, commit re-validates everything server-side.
router.post(
  '/import/preview',
  writeRoles,
  uploadExcelFile,
  asyncHandler(productsController.importPreview),
);

router.post(
  '/import',
  writeRoles,
  uploadExcelFile,
  validate({ body: importCommitSchema }),
  asyncHandler(productsController.importCommit),
);

router.get(
  '/:productId',
  validate({ params: productIdParam }),
  asyncHandler(productsController.getOne),
);

router.patch(
  '/:productId/status',
  writeRoles,
  validate({ params: productIdParam, body: productStatusSchema }),
  asyncHandler(productsController.setStatus),
);

router.patch(
  '/:productId',
  writeRoles,
  validate({ params: productIdParam, body: updateProductSchema }),
  asyncHandler(productsController.update),
);

router.delete(
  '/:productId',
  writeRoles,
  validate({ params: productIdParam }),
  asyncHandler(productsController.remove),
);

export const productsRoutes = router;
