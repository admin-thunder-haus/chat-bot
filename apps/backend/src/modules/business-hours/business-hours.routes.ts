import { Router } from 'express';
import { businessHoursController } from './business-hours.controller';
import {
  dayOfWeekParamSchema,
  singleDayBodySchema,
  updateScheduleSchema,
} from './business-hours.validation';
import { authenticate, authorizeRoles } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();
const writeRoles = authorizeRoles('OWNER', 'ADMIN');

router.use(authenticate);

router.get('/', asyncHandler(businessHoursController.get));

router.put(
  '/',
  writeRoles,
  validate({ body: updateScheduleSchema }),
  asyncHandler(businessHoursController.save),
);

router.patch(
  '/:dayOfWeek',
  writeRoles,
  validate({ params: dayOfWeekParamSchema, body: singleDayBodySchema }),
  asyncHandler(businessHoursController.updateDay),
);

export const businessHoursRoutes = router;
