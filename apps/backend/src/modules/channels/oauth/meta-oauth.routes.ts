import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorizeRoles } from '../../../middlewares/auth.middleware';
import { authRateLimiter } from '../../../middlewares/rateLimit.middleware';
import { validate } from '../../../middlewares/validate.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { metaOauthController } from './meta-oauth.controller';

/**
 * Meta OAuth / Embedded Signup routes. Mounted at /api/v1/channels/oauth
 * (before /channels so these literal paths always win).
 *
 * The callback is deliberately PUBLIC: the browser returns from Meta without
 * our JWT. The signed state (HMAC, 10-minute TTL) carries and authenticates
 * the tenant instead, and the endpoint only ever 302-redirects back to the
 * dashboard with safe machine-readable codes.
 */
const router = Router();
const manageRoles = authorizeRoles('OWNER', 'ADMIN');

const startSchema = z
  .object({
    provider: z.enum(['facebook', 'instagram', 'whatsapp']),
  })
  .strict();

const completeWhatsAppSchema = z
  .object({
    code: z.string().trim().min(4).max(2000),
    phoneNumberId: z.string().trim().min(1).max(64).optional(),
    wabaId: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

// Safe status (no secrets) — any authenticated role may read it.
router.get(
  '/meta/status',
  authenticate,
  asyncHandler(metaOauthController.status),
);

// Begin the redirect flow — OWNER/ADMIN only (it creates a channel on return).
router.post(
  '/meta/start',
  authenticate,
  manageRoles,
  validate({ body: startSchema }),
  asyncHandler(metaOauthController.start),
);

// OAuth redirect target — PUBLIC (state carries the tenant), rate limited.
router.get(
  '/meta/callback',
  authRateLimiter,
  asyncHandler(metaOauthController.callback),
);

// JS-SDK Embedded Signup popup completion — authenticated JSON variant.
router.post(
  '/meta/whatsapp/complete',
  authenticate,
  manageRoles,
  validate({ body: completeWhatsAppSchema }),
  asyncHandler(metaOauthController.completeWhatsApp),
);

export const metaOauthRoutes = router;
