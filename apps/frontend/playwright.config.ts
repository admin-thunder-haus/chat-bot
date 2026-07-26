import { defineConfig, devices } from '@playwright/test';
// Importing this here (not only from the specs) means the LOCAL-ONLY guard runs
// while the config is loaded — an accidental production URL fails the run before
// any browser starts. See e2e/env.ts.
import { API_URL, BASE_URL } from './e2e/env';

/**
 * Headless Playwright smoke suite for the dashboard.
 *
 * Deliberately separate from vitest: vitest only collects
 * `src/**\/*.test.{ts,tsx}` (vitest.config.ts) while `testDir` below points at
 * `e2e/` and `testMatch` at `*.spec.ts`, so neither runner can ever pick up the
 * other's files. `npm test` stays `vitest run`; this suite is `npm run e2e`.
 *
 * Requires a LOCAL backend on a LOCAL seeded database — see e2e/README.md.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',

  // The specs share one seeded company, and one of them creates data another
  // could page out of view; serial keeps them independent and cheap to debug.
  fullyParallel: false,
  workers: 1,

  forbidOnly: Boolean(process.env.CI),
  // Retries in CI only: locally a flake should be seen, not papered over.
  retries: process.env.CI ? 2 : 0,

  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],

  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  /**
   * Only the FRONTEND is managed here. The backend is not: it needs a running
   * Postgres and a seeded schema, and Playwright's webServer has no way to
   * express that ordering — a half-seeded database would produce mystery
   * failures instead of a clear setup error. Start it yourself (README) and this
   * config verifies it is local before touching it.
   *
   * `reuseExistingServer` outside CI means an already-running `npm run dev`
   * is used as-is; NEXT_PUBLIC_API_URL is only applied to a server this config
   * starts itself.
   */
  webServer: {
    // The port is taken from BASE_URL rather than hardcoded, so overriding
    // E2E_BASE_URL to a free port starts the dev server on that same port
    // instead of waiting forever on one nothing is listening to.
    command: `npx next dev -p ${new URL(BASE_URL).port || '3000'}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { NEXT_PUBLIC_API_URL: API_URL },
  },
});
