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

  // --- Email verification (registration) ---
  // When enabled, new registrations must confirm a 6-digit emailed code before
  // they can log in. Pre-existing users are backfilled as verified by the
  // migration, so enabling this never locks out current accounts.
  EMAIL_VERIFICATION_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  EMAIL_VERIFICATION_CODE_TTL_MS: z.coerce
    .number()
    .int()
    .min(60000)
    .default(900000), // 15 minutes
  // Minimum delay between two "resend code" emails for the same user.
  EMAIL_VERIFICATION_RESEND_COOLDOWN_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(60000),
  // Wrong-code attempts allowed per issued code before a new one is required.
  EMAIL_VERIFICATION_MAX_ATTEMPTS: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5),

  // --- Password reset ---
  // The reset link carries a 256-bit random token, so the TTL is the only
  // brute-force control needed. One hour is long enough to survive a slow
  // inbox and short enough that a forwarded email goes stale quickly.
  PASSWORD_RESET_TOKEN_TTL_MS: z.coerce
    .number()
    .int()
    .min(60000)
    .default(3600000), // 1 hour
  // Minimum delay between two reset emails for the same account (mail flood).
  PASSWORD_RESET_REQUEST_COOLDOWN_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(60000),

  // SMTP transport for outbound email. All optional: when SMTP_HOST is unset
  // the mailer falls back to logging emails (codes remain usable in dev and
  // the platform keeps working before SMTP is provisioned).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default('AI Support <no-reply@localhost>'),

  // --- Day 4: AI response engine ---
  // AI is OFF by default so the platform runs fully without OpenAI. When
  // enabled (and not in tests), OPENAI_API_KEY becomes required at startup.
  AI_FEATURE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Platform-wide KILL SWITCH for automatic replies — NOT the opt-in. The real
  // opt-in is the per-company `CompanyAISettings.autoReplyEnabled` toggle
  // (default false), so no tenant auto-replies until it turns the feature on.
  // Set this to `false` only to disable auto-reply for every company at once.
  // Validated here; READ LAZILY via isAutoReplyGloballyEnabled() so tests can
  // toggle it without re-importing env.
  AI_AUTO_REPLY_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
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

  // --- Day 11: voice transcription + PDF knowledge ---
  // Voice notes are transcribed with OpenAI when AI is enabled; disable to
  // store voice messages without transcription (AI skips them).
  AI_TRANSCRIPTION_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  OPENAI_TRANSCRIPTION_MODEL: z.string().default('whisper-1'),
  // Uploaded knowledge PDFs: per-file size cap (MB).
  KNOWLEDGE_DOC_MAX_FILE_MB: z.coerce.number().int().min(1).max(25).default(10),

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
  // In-process retry sweeper: how often due retries (and deliveries orphaned in
  // SENDING by a restart) are picked up. Minimum 1s so a misconfigured value
  // cannot turn the sweeper into a database busy-loop.
  CHANNEL_RETRY_SWEEP_MS: z.coerce.number().int().min(1000).default(60000),
  // Kill switch for that sweeper — turn it off to run the backend as a pure
  // request/webhook server (an external worker then drives the retries).
  // Validated here; READ LAZILY via isChannelRetrySweepEnabled() so tests can
  // toggle it without re-importing env.
  CHANNEL_RETRY_SWEEP_ENABLED: z.enum(['true', 'false']).default('true'),

  // --- Background job queue ---
  // Postgres-backed queue with an in-process worker. Chosen over Redis/BullMQ
  // because the deployment is a SINGLE instance with no Redis: SELECT ... FOR
  // UPDATE SKIP LOCKED already gives claim-once semantics, jobs survive the
  // restarts the free tier does constantly, and it adds no infrastructure cost.
  // Kill switch is READ LAZILY via isJobsWorkerEnabled().
  JOBS_WORKER_ENABLED: z.enum(['true', 'false']).default('true'),
  // How often the worker looks for due work. Seconds, not minutes: an uploaded
  // PDF and an inbound message both want to be picked up promptly. Minimum 250ms
  // so a misconfigured value cannot become a database busy-loop.
  JOBS_POLL_MS: z.coerce.number().int().min(250).default(2000),
  // Total attempts (first run + retries) before a job is dead-lettered.
  JOBS_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  // Same backoff shape as the channel delivery engine, so operators have only
  // one retry curve to reason about.
  JOBS_BACKOFF_BASE_MS: z.coerce.number().int().min(1).default(2000),
  JOBS_BACKOFF_FACTOR: z.coerce.number().min(1).max(10).default(3),
  JOBS_BACKOFF_MAX_MS: z.coerce.number().int().min(1000).default(600000),
  JOBS_BACKOFF_JITTER: z.coerce.number().min(0).max(1).default(0.2),
  // Finished (SUCCEEDED/FAILED) jobs are pruned after this many days. DEAD jobs
  // are deliberately NEVER pruned: they are the record of what was lost.
  JOBS_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),

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

  // --- Day 8: Facebook Messenger (Meta) ---
  // NON-secret global config only. Per-account secrets (page access token, app
  // secret, verify token) are supplied at connect time and stored ENCRYPTED per
  // account (never via env). Facebook Messenger uses graph.facebook.com.
  FACEBOOK_PROVIDER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  FACEBOOK_GRAPH_API_BASE_URL: z
    .string()
    .url()
    .default('https://graph.facebook.com'),
  FACEBOOK_GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, 'Must be a Graph API version like v21.0')
    .default('v21.0'),
  FACEBOOK_API_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(15000),

  // --- Day 9: Telegram Bot API ---
  // The per-bot token + webhook secret are supplied at connect time and stored
  // ENCRYPTED per account (never via env).
  TELEGRAM_PROVIDER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  TELEGRAM_API_BASE_URL: z.string().url().default('https://api.telegram.org'),
  TELEGRAM_API_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(15000),

  // --- Day 12: Meta OAuth / Embedded Signup (one-click channel connect) ---
  // ALL optional: when META_APP_ID / META_APP_SECRET are unset the OAuth flow
  // is simply disabled and the manual connect forms remain the only path.
  // These identify OUR Meta app (platform-level) — they are NOT per-tenant
  // credentials. Per-account tokens obtained via OAuth are still stored
  // encrypted per channel account, exactly like the manual flow.
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, 'Must be a Graph API version like v21.0')
    .default('v21.0'),
  // Embedded Signup configuration id (WhatsApp) — from the Meta app dashboard
  // under WhatsApp > Embedded Signup.
  WHATSAPP_ES_CONFIG_ID: z.string().optional(),
  // Facebook Login for Business configuration id (Messenger + Instagram).
  META_LOGIN_CONFIG_ID: z.string().optional(),
  // Where the browser is redirected after the OAuth callback completes.
  FRONTEND_APP_URL: z.string().url().default('http://localhost:3000'),

  // --- Day 12: AI actions ---
  // Master switch for AI-performed business actions (appointments, orders,
  // support tickets, availability lookups). Validated here; READ LAZILY via
  // isAiActionsEnabled() so tests can toggle it without re-importing env.
  AI_ACTIONS_ENABLED: z.enum(['true', 'false']).default('true'),

  // --- Day 12: billing & subscriptions ---
  // MASTER SWITCH for the whole billing module. OFF by default: customers are
  // invoiced offline (bank transfer / cash) until subscriptions are launched.
  // While disabled, NO plan limit is enforced anywhere, no trial subscription
  // is created, the billing API answers 410, and the dashboard hides Billing.
  // Flip this single variable to 'true' to restore the full behaviour.
  // Validated here; READ LAZILY via isBillingEnabled() so tests can toggle it.
  BILLING_ENABLED: z.enum(['true', 'false']).default('false'),
  // Length of the free trial every new company starts on.
  BILLING_TRIAL_DAYS: z.coerce.number().int().min(1).max(365).default(14),
  // Stripe is OPTIONAL. When STRIPE_SECRET_KEY is unset the platform runs in
  // OFFLINE billing mode: plan changes apply immediately with no checkout.
  // When set, plan changes route through Stripe hosted checkout and the
  // webhook (verified with STRIPE_WEBHOOK_SECRET when provided) applies them.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // --- Login audit trail ---
  // How long a recorded sign-in attempt is kept. Long enough that "was that me
  // last quarter?" is answerable, short enough that the table stays small and a
  // stale IP/user-agent trail is not a liability we hold forever.
  LOGIN_AUDIT_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(1)
    .max(3650)
    .default(90),
  // Kill switch for the opportunistic prune that rides along on a login write.
  // Turn it off only to prune from outside the app (a cron/SQL job).
  // Validated here; READ LAZILY via isLoginAuditPruneEnabled() so tests can
  // toggle it without re-importing env.
  LOGIN_AUDIT_PRUNE_ENABLED: z.enum(['true', 'false']).default('true'),

  // --- Error tracking (Sentry) ---
  // FULLY OPTIONAL. Without SENTRY_DSN the SDK is never even loaded, let alone
  // initialised: no network, no instrumentation, no overhead (config/sentry.ts).
  // Set it per environment in the Render dashboard, never in the repo.
  SENTRY_DSN: z.string().optional(),
  // Environment label shown in Sentry. Kept optional instead of defaulted
  // because a zod default cannot read NODE_ENV from the same object — the
  // fallback to NODE_ENV lives in config/sentry.ts.
  SENTRY_ENVIRONMENT: z.string().optional(),
  // Performance tracing is OFF by default: this integration reports unexpected
  // server errors from the central error middleware and installs no tracing.
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
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

/** True when new registrations must verify their email before logging in. */
export const isEmailVerificationEnabled = env.EMAIL_VERIFICATION_ENABLED;

/**
 * The development fake channel is available only when explicitly enabled AND
 * never in production. This gates both fake account creation and the fake
 * public webhook surface, so production can never expose test functionality.
 */
export const isFakeChannelEnabled = env.FAKE_CHANNEL_ENABLED && !isProduction;

/** Instagram provider is registered only when enabled for this environment. */
export const isInstagramEnabled = env.INSTAGRAM_PROVIDER_ENABLED;

/** Facebook Messenger provider is registered only when enabled. */
export const isFacebookEnabled = env.FACEBOOK_PROVIDER_ENABLED;

/** Telegram provider is registered only when enabled. */
export const isTelegramEnabled = env.TELEGRAM_PROVIDER_ENABLED;

/**
 * True when the AI may perform business actions (book/order/ticket/lookup).
 * Deliberately a FUNCTION reading process.env at call time — the frozen `env`
 * snapshot cannot be toggled by tests, and this flag must stay testable.
 */
export function isAiActionsEnabled(): boolean {
  return (process.env.AI_ACTIONS_ENABLED ?? 'true') !== 'false';
}

/**
 * Platform-wide kill switch for automatic AI replies. Enabled unless explicitly
 * set to 'false' — the meaningful opt-in is the per-company
 * `CompanyAISettings.autoReplyEnabled` flag, which still defaults to false.
 * Deliberately a FUNCTION reading process.env at call time (same reason as
 * isAiActionsEnabled): the frozen `env` snapshot cannot be toggled by tests.
 */
export function isAutoReplyGloballyEnabled(): boolean {
  return (process.env.AI_AUTO_REPLY_ENABLED ?? 'true') !== 'false';
}

/**
 * Master switch for billing & subscriptions. OFF unless explicitly enabled —
 * while off the platform behaves as if every tenant were unlimited and no
 * subscription rows are ever created (customers are invoiced offline).
 * Deliberately a FUNCTION reading process.env at call time (same reason as
 * isAiActionsEnabled): the frozen `env` snapshot cannot be toggled by tests.
 */
export function isBillingEnabled(): boolean {
  return (process.env.BILLING_ENABLED ?? 'false') === 'true';
}

/**
 * Whether the in-process channel delivery retry sweeper may run. Enabled unless
 * explicitly set to 'false', and ALWAYS off under tests: a background timer that
 * outlives a test file would race the per-test database reset. Tests drive a
 * sweep explicitly via runSweepOnce() instead.
 * Deliberately a FUNCTION reading process.env at call time (same reason as
 * isAiActionsEnabled): the frozen `env` snapshot cannot be toggled by tests.
 */
export function isChannelRetrySweepEnabled(): boolean {
  if (process.env.NODE_ENV === 'test') return false;
  return (process.env.CHANNEL_RETRY_SWEEP_ENABLED ?? 'true') !== 'false';
}

/**
 * Whether the in-process background job worker may run. Same reasoning as the
 * retry sweeper: enabled unless explicitly disabled, and ALWAYS off under tests
 * so no timer races the per-test database reset. Tests enqueue and then call
 * jobsService.drainJobs() to run the work deterministically.
 */
export function isJobsWorkerEnabled(): boolean {
  if (process.env.NODE_ENV === 'test') return false;
  return (process.env.JOBS_WORKER_ENABLED ?? 'true') !== 'false';
}

/**
 * Whether a login may opportunistically prune the audit trail. ALWAYS off under
 * tests for the same reason as the sweepers above: a fire-and-forget delete
 * would race the per-test database reset. Tests call
 * pruneLoginAuditEvents() directly instead.
 * Deliberately a FUNCTION reading process.env at call time (same reason as
 * isAiActionsEnabled): the frozen `env` snapshot cannot be toggled by tests.
 */
export function isLoginAuditPruneEnabled(): boolean {
  if (process.env.NODE_ENV === 'test') return false;
  return (process.env.LOGIN_AUDIT_PRUNE_ENABLED ?? 'true') !== 'false';
}

/**
 * Platform-level feature flags handed to the dashboard so the UI can hide what
 * the backend will refuse to serve. Read at call time (never cached) and sent
 * with every auth payload, so a Render env change takes effect on next login.
 */
export interface PlatformFeatures {
  billing: boolean;
  aiActions: boolean;
}

export function platformFeatures(): PlatformFeatures {
  return {
    billing: isBillingEnabled(),
    aiActions: isAiActionsEnabled(),
  };
}
