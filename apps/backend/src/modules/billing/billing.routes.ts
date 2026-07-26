import { Router, type NextFunction, type Request, type Response } from 'express';
import { billingController } from './billing.controller';
import { changePlanSchema } from './billing.validation';
import {
  authenticate,
  authorizeRoles,
} from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/AppError';
import { isBillingEnabled } from '../../config/env';

const router = Router();
const ownerOnly = authorizeRoles('OWNER');

/**
 * Master gate for the whole module. With BILLING_ENABLED off (the launch
 * default) every billing endpoint — including the Stripe webhook — answers
 * 410 Gone instead of doing any work, so no subscription row can be created
 * and no payment event can be processed while the platform bills offline.
 * Placed before every handler so it also covers the unauthenticated webhook.
 */
function requireBillingEnabled(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (isBillingEnabled()) {
    next();
    return;
  }
  next(
    new AppError(
      'Billing is not enabled on this platform',
      410,
      [],
      true,
      'BILLING_DISABLED',
    ),
  );
}

router.use(requireBillingEnabled);

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
