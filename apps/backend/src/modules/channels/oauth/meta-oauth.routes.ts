import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorizeRoles } from '../../../middlewares/auth.middleware';
import { authRateLimiter } from '../../../middlewares/rateLimit.middleware';
import { validate } from '../../../middlewares/validate.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { instagramLoginController } from './instagram-login.controller';
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

const selectionParamsSchema = z
  .object({ selectionId: z.string().uuid('A valid selection id is required') })
  .strict();

/**
 * The chosen asset. Which fields are required depends on the provider, and the
 * service is the authority on that (it matches the choice against the stored
 * assets); this schema only bounds the shapes so nothing oversized or
 * unexpected reaches it.
 */
const connectSelectionSchema = z
  .object({
    pageId: z.string().trim().min(1).max(64).optional(),
    wabaId: z.string().trim().min(1).max(64).optional(),
    phoneNumberId: z.string().trim().min(1).max(64).optional(),
  })
  .strict()
  .refine((d) => Boolean(d.pageId || (d.wabaId && d.phoneNumberId)), {
    message:
      'Provide pageId, or both wabaId and phoneNumberId for a WhatsApp number',
  });

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

/**
 * Asset selection. Both routes are AUTHENTICATED and OWNER/ADMIN: the callback
 * that created the selection is public, so the picker is where we re-establish
 * who is asking. The selection is additionally scoped to the caller's company
 * inside the service, so holding the id is never sufficient.
 */
router.get(
  '/meta/selection/:selectionId',
  authenticate,
  manageRoles,
  validate({ params: selectionParamsSchema }),
  asyncHandler(metaOauthController.getSelection),
);

router.post(
  '/meta/selection/:selectionId/connect',
  authenticate,
  manageRoles,
  validate({ params: selectionParamsSchema, body: connectSelectionSchema }),
  asyncHandler(metaOauthController.connectSelection),
);

/**
 * Instagram API with Instagram Login — the one-click Instagram path.
 *
 * Separate from /meta/* because it is a different OAuth flow against a
 * different host with a different app identity, not a provider variant of the
 * Facebook one. Same shape and same guarantees though: status is readable by
 * any authenticated role, start is OWNER/ADMIN, and the callback is PUBLIC and
 * rate limited because the browser returns from Instagram without our JWT —
 * the signed state carries and authenticates the tenant instead.
 */
router.get(
  '/instagram-login/status',
  authenticate,
  asyncHandler(instagramLoginController.status),
);

router.post(
  '/instagram-login/start',
  authenticate,
  manageRoles,
  asyncHandler(instagramLoginController.start),
);

router.get(
  '/instagram-login/callback',
  authRateLimiter,
  asyncHandler(instagramLoginController.callback),
);

export const metaOauthRoutes = router;
