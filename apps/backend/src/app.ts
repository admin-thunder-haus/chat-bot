import express, { type Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { corsOptions, widgetCorsOptions } from './config/cors';
import { apiV1Router } from './routes';
import {
  errorHandler,
  notFound,
  requestId,
  requestLogger,
  apiRateLimiter,
  webhookRateLimiter,
  widgetRateLimiter,
} from './middlewares';
import { webhookRoutes } from './modules/channels';
import { widgetRoutes } from './modules/widget';
import { sendSuccess } from './utils/apiResponse';

/** Build and configure the Express application (no network binding here). */
export function createApp(): Application {
  const app = express();

  // We sit behind a single proxy (docker/reverse proxy) in most setups; this
  // lets express-rate-limit read the correct client IP from X-Forwarded-For.
  app.set('trust proxy', 1);

  // --- Security & parsing ---
  app.use(helmet());

  // --- Public Web Chat widget API (NO JWT) ---
  // Mounted BEFORE the global CORS (which throws for non-allowlisted origins),
  // with its OWN permissive, cookie-free CORS + JSON parser + dedicated limiter.
  // The widget is embedded on arbitrary customer sites; it authenticates with a
  // public widget key + signed session token, never cookies.
  app.use(
    '/api/v1/widget',
    cors(widgetCorsOptions),
    requestId,
    express.json({ limit: env.JSON_BODY_LIMIT }),
    widgetRateLimiter,
    widgetRoutes,
  );

  app.use(cors(corsOptions));
  app.use(cookieParser());
  // Capture the raw body bytes so the webhook engine can verify provider
  // signatures. This does not change normal JSON parsing for any other route.
  app.use(
    express.json({
      limit: env.JSON_BODY_LIMIT,
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: env.JSON_BODY_LIMIT }));

  // --- Observability ---
  app.use(requestId);
  app.use(requestLogger);

  // --- Liveness probe (top-level, unthrottled) ---
  app.get('/health', (_req, res) => {
    sendSuccess(
      res,
      { status: 'ok', uptime: process.uptime() },
      'Service is healthy',
    );
  });

  // --- Public webhook engine (NO JWT) ---
  // Mounted BEFORE the general API limiter with its OWN dedicated limiter, so
  // webhook traffic has a completely separate budget from dashboard/API calls.
  app.use('/api/v1/webhooks', webhookRateLimiter, webhookRoutes);

  // --- API v1 (rate limited) ---
  app.use('/api', apiRateLimiter);
  app.use('/api/v1', apiV1Router);

  // --- 404 + centralized error handling (must be last) ---
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
