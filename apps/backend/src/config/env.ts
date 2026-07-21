import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Load .env when running outside Docker. In Docker, env vars are injected by
// compose, and a missing file is simply ignored.
loadDotenv();

/**
 * Schema for all environment variables the backend depends on.
 * Validated once at startup so the process fails fast on misconfiguration
 * instead of erroring deep inside a request handler.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  BACKEND_PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Secrets must be reasonably strong. Enforced regardless of environment.
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),

  // Comma-separated origin allowlist -> string[].
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),

  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  JSON_BODY_LIMIT: z.string().default('100kb'),

  // General API limiter — generous enough for real dashboard usage.
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(500),
  // Login / register — strict to deter brute-force and signup abuse.
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(900000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  // Refresh — its own budget: short window, higher max, so normal token
  // rotation (and React Strict Mode double-mounts) never hits the login limit.
  REFRESH_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60000),
  REFRESH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),

  // --- Day 4: AI response engine ---
  // AI is OFF by default so the platform runs fully without OpenAI. When
  // enabled (and not in tests), OPENAI_API_KEY becomes required at startup.
  AI_FEATURE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Global gate for automatic replies; per-company opt-in is also required.
  AI_AUTO_REPLY_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  OPENAI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(16).max(4000).default(500),
  OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  OPENAI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.3),

  AI_CONTEXT_MAX_CHARACTERS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(200000)
    .default(30000),
  AI_CONVERSATION_HISTORY_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .default(12),
  AI_DAILY_COMPANY_REQUEST_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .default(1000),
  AI_MONTHLY_COMPANY_TOKEN_LIMIT: z.coerce
    .number()
    .int()
    .min(1000)
    .default(1000000),

  AI_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  AI_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),

  // --- Day 5 Part 1: channel integration framework ---
  // Credential encryption. The key is a base64-encoded 32-byte key used for
  // AES-256-GCM. It is only *required* once a provider that stores credentials
  // is configured (the fake provider needs none), so it stays optional here and
  // is validated lazily by the channel security service when actually used.
  CHANNEL_CREDENTIAL_ENCRYPTION_KEY: z.string().optional(),
  CHANNEL_CREDENTIAL_ENCRYPTION_VERSION: z.string().default('v1'),

  // Webhook engine limiter — separate budget from the dashboard/API limiters.
  WEBHOOK_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60000),
  WEBHOOK_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

  // Development fake/test channel. Disabled by default; never active in
  // production regardless of this flag (see isFakeChannelEnabled below).
  FAKE_CHANNEL_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  FAKE_CHANNEL_WEBHOOK_SECRET: z.string().optional(),
  FAKE_CHANNEL_VERIFY_TOKEN: z.string().optional(),

  // --- Day 5 Part 2: delivery engine / retry policy ---
  // Total attempts (first send + retries) before a temporary failure is
  // considered permanently failed.
  CHANNEL_DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(3),
  // Exponential backoff: delay = base * factor^(attempt-1), capped at max, with
  // proportional jitter. Values in milliseconds.
  CHANNEL_DELIVERY_BACKOFF_BASE_MS: z.coerce
    .number()
    .int()
    .min(1)
    .default(1000),
  CHANNEL_DELIVERY_BACKOFF_FACTOR: z.coerce.number().min(1).max(10).default(2),
  CHANNEL_DELIVERY_BACKOFF_MAX_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(300000),
  // Fraction of the computed delay added as random jitter (0..1).
  CHANNEL_DELIVERY_BACKOFF_JITTER: z.coerce.number().min(0).max(1).default(0.2),
  // A delivery that has not succeeded within this window is EXPIRED (no retry).
  CHANNEL_DELIVERY_TTL_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(86400000),

  // --- Day 5 Part 3: Web Chat widget ---
  // Secret used to sign stateless widget session tokens (HMAC). Required once a
  // Web Chat channel is actually used; validated lazily by the session service.
  WIDGET_SESSION_SECRET: z.string().optional(),
  // How long a widget session token stays valid (visitor reconnect window).
  WIDGET_SESSION_TTL_MS: z.coerce
    .number()
    .int()
    .min(60000)
    .default(2592000000), // 30 days
  // Dedicated limiter for the public widget API (separate budget).
  WIDGET_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60000),
  WIDGET_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(240),

  // --- Day 6: WhatsApp Business Cloud API (Meta) ---
  // NON-secret global config only. Per-account secrets (access token, app secret,
  // verify token) are supplied at connect time and stored ENCRYPTED per account
  // (never via env). The Graph API base + version are overridable for testing /
  // pinning; requests have a bounded timeout.
  WHATSAPP_API_BASE_URL: z
    .string()
    .url()
    .default('https://graph.facebook.com'),
  WHATSAPP_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, 'Must be a Graph API version like v21.0')
    .default('v21.0'),
  WHATSAPP_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(15000),

  // --- Day 7: Instagram Messaging (Meta) ---
  // NON-secret global config only. Per-account secrets (access token, app secret,
  // verify token) are supplied at connect time and stored ENCRYPTED per account
  // (never via env). The provider can be disabled entirely for an environment.
  INSTAGRAM_PROVIDER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Instagram Messaging uses the "Instagram API with Instagram Login" flow,
  // whose access tokens (IGAA…) are served by graph.instagram.com — NOT
  // graph.facebook.com (which only accepts Facebook Page tokens, EAA…). Override
  // per-environment only if you use the legacy Facebook-Page-linked flow.
  INSTAGRAM_GRAPH_API_BASE_URL: z
    .string()
    .url()
    .default('https://graph.instagram.com'),
  INSTAGRAM_GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, 'Must be a Graph API version like v21.0')
    .default('v21.0'),
  INSTAGRAM_API_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(15000),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(
      `\n❌ Invalid environment configuration:\n${issues}\n`,
    );
    process.exit(1);
  }

  // Refresh secrets must differ to avoid cross-signing access/refresh tokens.
  if (parsed.data.JWT_ACCESS_SECRET === parsed.data.JWT_REFRESH_SECRET) {
    // eslint-disable-next-line no-console
    console.error(
      '\n❌ JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different.\n',
    );
    process.exit(1);
  }

  // When AI is enabled the OpenAI key is mandatory — except under tests, where
  // the provider is always mocked. This gives a clear startup failure in
  // dev/prod without blocking the automated suite.
  if (
    parsed.data.AI_FEATURE_ENABLED &&
    parsed.data.NODE_ENV !== 'test' &&
    !parsed.data.OPENAI_API_KEY
  ) {
    // eslint-disable-next-line no-console
    console.error(
      '\n❌ AI_FEATURE_ENABLED=true requires OPENAI_API_KEY to be set.\n',
    );
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** True when the AI feature can actually run (enabled + key, or test mode). */
export const isAIEnabled = env.AI_FEATURE_ENABLED;

/**
 * The development fake channel is available only when explicitly enabled AND
 * never in production. This gates both fake account creation and the fake
 * public webhook surface, so production can never expose test functionality.
 */
export const isFakeChannelEnabled = env.FAKE_CHANNEL_ENABLED && !isProduction;

/** Instagram provider is registered only when enabled for this environment. */
export const isInstagramEnabled = env.INSTAGRAM_PROVIDER_ENABLED;
