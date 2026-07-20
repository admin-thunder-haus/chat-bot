/**
 * Global test setup. Runs before each test file (setupFilesAfterEnv).
 * Provides sane defaults for required env vars so the app boots in tests, and
 * exposes a helper to reset the database between tests.
 *
 * A dedicated TEST database must be reachable via TEST_DATABASE_URL (falls back
 * to a local Postgres on port 5433). NEVER point this at the dev database.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ??
  'test-access-secret-that-is-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ??
  'test-refresh-secret-that-is-at-least-32-chars-different';
process.env.JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN ?? '15m';
process.env.JWT_REFRESH_EXPIRES_IN =
  process.env.JWT_REFRESH_EXPIRES_IN ?? '30d';
// Keep bcrypt fast in tests.
process.env.BCRYPT_SALT_ROUNDS = process.env.BCRYPT_SALT_ROUNDS ?? '10';
// AI enabled in tests; the provider is always mocked via setAIProviderForTesting
// so the real OpenAI API is never called. No OPENAI_API_KEY is set.
process.env.AI_FEATURE_ENABLED = 'true';
process.env.AI_AUTO_REPLY_ENABLED = 'true';
process.env.OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

// --- Day 5: channel framework test config (controlled secrets, never real) ---
// Fake channel enabled so its provider is registered and tests can exercise it.
process.env.FAKE_CHANNEL_ENABLED = 'true';
process.env.FAKE_CHANNEL_WEBHOOK_SECRET =
  process.env.FAKE_CHANNEL_WEBHOOK_SECRET ?? 'test-fake-webhook-secret';
process.env.FAKE_CHANNEL_VERIFY_TOKEN =
  process.env.FAKE_CHANNEL_VERIFY_TOKEN ?? 'test-fake-verify-token';
// Deterministic base64-encoded 32-byte AES key for credential encryption tests.
process.env.CHANNEL_CREDENTIAL_ENCRYPTION_KEY =
  process.env.CHANNEL_CREDENTIAL_ENCRYPTION_KEY ??
  Buffer.alloc(32, 7).toString('base64');

// --- Day 5 Part 3: Web Chat widget session secret (controlled test value) ---
process.env.WIDGET_SESSION_SECRET =
  process.env.WIDGET_SESSION_SECRET ??
  'test-widget-session-secret-at-least-32-chars-long';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/ai_support_test?schema=public';

// Import after env is configured so the env validation sees the test values.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { prisma } from '../src/config/prisma';

/** Remove all rows in FK-safe order. */
export async function resetDatabase(): Promise<void> {
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.company.deleteMany();
}

beforeAll(async () => {
  await prisma.$connect();
  await resetDatabase();
});

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

export { prisma };
