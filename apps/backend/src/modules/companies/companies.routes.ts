import { Router } from 'express';
import { companiesController } from './companies.controller';
import { updateProfileSchema } from './companies.validation';
import { authenticate, authorizeRoles } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

// All company routes require authentication.
router.use(authenticate);

// Any authenticated role may view the profile.
router.get('/profile', asyncHandler(companiesController.getProfile));

// Only OWNER / ADMIN may update it.
router.patch(
  '/profile',
  authorizeRoles('OWNER', 'ADMIN'),
  validate({ body: updateProfileSchema }),
  asyncHandler(companiesController.updateProfile),
);

export const companiesRoutes = router;
