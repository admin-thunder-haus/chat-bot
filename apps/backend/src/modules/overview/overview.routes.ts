import { Router } from 'express';
import { overviewController } from './overview.controller';
import { authenticate } from '../../middlewares/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

router.use(authenticate);

// Any authenticated role may view the dashboard overview.
router.get('/', asyncHandler(overviewController.get));

export const overviewRoutes = router;
