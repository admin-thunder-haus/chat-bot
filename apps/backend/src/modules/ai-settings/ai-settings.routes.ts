import { Router } from 'express';
import { aiSettingsController } from './ai-settings.controller';
import { updateAISettingsSchema } from './ai-settings.validation';
import { authenticate, authorizeRoles } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

router.use(authenticate);

// Any authenticated role may read AI settings.
router.get('/', asyncHandler(aiSettingsController.get));

// OWNER / ADMIN may update.
router.put(
  '/',
  authorizeRoles('OWNER', 'ADMIN'),
  validate({ body: updateAISettingsSchema }),
  asyncHandler(aiSettingsController.save),
);

export const aiSettingsRoutes = router;
