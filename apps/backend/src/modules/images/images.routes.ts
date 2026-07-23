import { Router } from 'express';
import { imagesController } from './images.controller';
import { uuidParam } from '../../validations/common.validation';
import { authenticate, authorizeRoles } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { uploadImageFile } from '../../middlewares/upload.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

const imageIdParam = uuidParam('imageId');

// Authenticated management routes (mounted at /images).
const router = Router();
router.use(authenticate);

router.post(
  '/',
  authorizeRoles('OWNER', 'ADMIN'),
  uploadImageFile,
  asyncHandler(imagesController.upload),
);

router.delete(
  '/:imageId',
  authorizeRoles('OWNER', 'ADMIN'),
  validate({ params: imageIdParam }),
  asyncHandler(imagesController.remove),
);

export const imagesRoutes = router;

// Public serving route (mounted at /public/images — NO auth): channel
// providers fetch attachment URLs anonymously; the UUID is the capability.
const publicRouter = Router();

publicRouter.get(
  '/:imageId',
  validate({ params: imageIdParam }),
  asyncHandler(imagesController.serve),
);

export const publicImagesRoutes = publicRouter;
