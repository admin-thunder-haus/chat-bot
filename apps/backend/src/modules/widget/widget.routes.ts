import { Router } from 'express';
import { widgetController } from './widget.controller';
import {
  startSessionSchema,
  widgetMessageSchema,
  widgetParamsSchema,
  widgetPollQuerySchema,
  widgetTypingSchema,
} from './widget.validation';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Public Web Chat widget API. NO JWT — the widget runs on arbitrary customer
 * websites. Authenticated by a public widget key (route) + a signed session
 * token (X-Widget-Session header). Mounted in app.ts with its own permissive
 * CORS + dedicated rate limiter, ahead of the global CORS/limiter.
 */
const router = Router();

router.get(
  '/:publicId/config',
  validate({ params: widgetParamsSchema }),
  asyncHandler(widgetController.config),
);

router.post(
  '/:publicId/session',
  validate({ params: widgetParamsSchema, body: startSessionSchema }),
  asyncHandler(widgetController.startSession),
);

router.post(
  '/:publicId/messages',
  validate({ params: widgetParamsSchema, body: widgetMessageSchema }),
  asyncHandler(widgetController.postMessage),
);

router.get(
  '/:publicId/messages',
  validate({ params: widgetParamsSchema, query: widgetPollQuerySchema }),
  asyncHandler(widgetController.pollMessages),
);

router.post(
  '/:publicId/typing',
  validate({ params: widgetParamsSchema, body: widgetTypingSchema }),
  asyncHandler(widgetController.typing),
);

export const widgetRoutes = router;
