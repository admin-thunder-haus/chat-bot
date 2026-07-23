import { Router } from 'express';
import { actionsController } from './actions.controller';
import {
  appointmentListQuerySchema,
  appointmentStatusSchema,
  executionListQuerySchema,
  orderListQuerySchema,
  orderStatusSchema,
  ticketListQuerySchema,
  ticketStatusSchema,
} from './actions.validation';
import { uuidParam } from '../../validations/common.validation';
import { authenticate } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Operations surface for AI-created business records. All routes are
 * authenticated; reads AND status updates are available to every role
 * (agents work these queues day to day).
 */
const router = Router();

router.use(authenticate);

// AI activity audit log.
router.get(
  '/executions',
  validate({ query: executionListQuerySchema }),
  asyncHandler(actionsController.listExecutions),
);

// Appointments.
router.get(
  '/appointments',
  validate({ query: appointmentListQuerySchema }),
  asyncHandler(actionsController.listAppointments),
);
router.patch(
  '/appointments/:appointmentId/status',
  validate({
    params: uuidParam('appointmentId'),
    body: appointmentStatusSchema,
  }),
  asyncHandler(actionsController.setAppointmentStatus),
);

// Orders (returned with their items).
router.get(
  '/orders',
  validate({ query: orderListQuerySchema }),
  asyncHandler(actionsController.listOrders),
);
router.patch(
  '/orders/:orderId/status',
  validate({ params: uuidParam('orderId'), body: orderStatusSchema }),
  asyncHandler(actionsController.setOrderStatus),
);

// Support tickets.
router.get(
  '/tickets',
  validate({ query: ticketListQuerySchema }),
  asyncHandler(actionsController.listTickets),
);
router.patch(
  '/tickets/:ticketId/status',
  validate({ params: uuidParam('ticketId'), body: ticketStatusSchema }),
  asyncHandler(actionsController.setTicketStatus),
);

export const actionsRoutes = router;
