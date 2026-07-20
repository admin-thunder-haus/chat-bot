import { Router } from 'express';
import { usersController } from './users.controller';
import { authenticate } from '../../middlewares/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

router.use(authenticate);

// Active users of the authenticated company that can be assigned conversations.
router.get('/assignable', asyncHandler(usersController.assignable));

export const usersRoutes = router;
