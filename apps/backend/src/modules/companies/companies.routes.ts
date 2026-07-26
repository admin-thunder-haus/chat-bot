import { Router } from 'express';
import { companiesController } from './companies.controller';
import {
  deleteCompanySchema,
  updateProfileSchema,
} from './companies.validation';
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

// GDPR portability. OWNER-only: the export contains every customer message in
// the workspace, which is not something an agent should be able to walk out
// with. Intended to be taken BEFORE deleting the company.
router.get(
  '/export',
  authorizeRoles('OWNER'),
  asyncHandler(companiesController.exportData),
);

// Permanent deletion. OWNER-only AND typed-name confirmed (validated in the
// schema, matched in the service) — the two guards are independent on purpose.
router.delete(
  '/',
  authorizeRoles('OWNER'),
  validate({ body: deleteCompanySchema }),
  asyncHandler(companiesController.deleteCompany),
);

export const companiesRoutes = router;
