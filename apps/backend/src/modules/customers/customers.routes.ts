import { Router } from 'express';
import { customersController } from './customers.controller';
import {
  createCustomerSchema,
  customerListQuerySchema,
  updateCustomerSchema,
} from './customers.validation';
import { conversationListQuerySchema } from '../conversations/conversations.validation';
import { uuidParam } from '../../validations/common.validation';
import { authenticate, authorizeRoles } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();
const writeRoles = authorizeRoles('OWNER', 'ADMIN');
const customerIdParam = uuidParam('customerId');

router.use(authenticate);

router.get(
  '/',
  validate({ query: customerListQuerySchema }),
  asyncHandler(customersController.list),
);

router.post(
  '/',
  writeRoles,
  validate({ body: createCustomerSchema }),
  asyncHandler(customersController.create),
);

router.get(
  '/:customerId',
  validate({ params: customerIdParam }),
  asyncHandler(customersController.getOne),
);

router.patch(
  '/:customerId',
  writeRoles,
  validate({ params: customerIdParam, body: updateCustomerSchema }),
  asyncHandler(customersController.update),
);

router.get(
  '/:customerId/conversations',
  validate({ params: customerIdParam, query: conversationListQuerySchema }),
  asyncHandler(customersController.listConversations),
);

export const customersRoutes = router;
