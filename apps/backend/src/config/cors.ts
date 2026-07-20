import type { CorsOptions } from 'cors';
import { env } from './env';

/**
 * CORS options built from the environment allowlist.
 * Requests with no Origin (curl, server-to-server, health checks) are allowed;
 * browser origins must appear in CORS_ORIGINS. credentials:true so the
 * refresh-token cookie can flow.
 */
export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || env.CORS_ORIGINS.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
};

/**
 * CORS for the PUBLIC Web Chat widget API. The widget is embedded on arbitrary
 * customer websites, so any origin may call it. It is safe to reflect the origin
 * here because widget requests carry NO cookies (credentials:false) — they
 * authenticate with a bearer widget-session token, and every endpoint is scoped
 * by a public widget key + signed session, not by ambient authority.
 */
export const widgetCorsOptions: CorsOptions = {
  origin: true,
  credentials: false,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Widget-Session', 'X-Request-Id'],
  maxAge: 600,
};
