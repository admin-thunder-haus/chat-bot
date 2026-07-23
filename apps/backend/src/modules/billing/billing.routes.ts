import { Router } from 'express';
import { billingController } from './billing.controller';
import { changePlanSchema } from './billing.validation';
import {
  authenticate,
  authorizeRoles,
} from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();
const ownerOnly = authorizeRoles('OWNER');

// --- Public payment-provider webhook (NO JWT) ---
// Registered BEFORE the authenticate middleware below (same pattern as the
// public routes in auth.routes). Signature verification happens in the
// controller against the raw body when STRIPE_WEBHOOK_SECRET is set.
router.post('/webhook/stripe', asyncHandler(billingController.stripeWebhook));

router.use(authenticate);

// Reads — any authenticated role.
router.get('/subscription', asyncHandler(billingController.getSubscription));
router.get('/plans', asyncHandler(billingController.listPlans));

// Plan management — OWNER only.
router.post(
  '/change-plan',
  ownerOnly,
  validate({ body: changePlanSchema }),
  asyncHandler(billingController.changePlan),
);
router.post('/cancel', ownerOnly, asyncHandler(billingController.cancel));
router.post('/resume', ownerOnly, asyncHandler(billingController.resume));

export const billingRoutes = router;
