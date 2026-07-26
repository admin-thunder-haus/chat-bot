import { test as base, expect } from '@playwright/test';
import { isLocalUrl } from './env';

/**
 * Second line of defence for the LOCAL-ONLY rule.
 *
 * e2e/env.ts checks the URLs the runner was CONFIGURED with; this checks what the
 * browser actually does. It matters because `apps/frontend/.env.local` may point
 * NEXT_PUBLIC_API_URL at the deployed Render backend: a dev server started
 * without an explicit override would serve a bundle that talks to production
 * while every configured URL still looked like localhost.
 *
 * Any http(s) request to a non-loopback host is BLOCKED (never sent) and the test
 * fails with the offending origin, so production can never be written to — not
 * even a login attempt.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const blocked = new Set<string>();

    await page.route('**/*', async (route) => {
      const url = route.request().url();
      const isHttp = url.startsWith('http://') || url.startsWith('https://');

      if (isHttp && !isLocalUrl(url)) {
        blocked.add(new URL(url).origin);
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });

    await use(page);

    if (blocked.size > 0) {
      throw new Error(
        `\n[e2e] The app tried to reach a NON-LOCAL origin: ${[...blocked].join(', ')}\n` +
          `      Those requests were blocked, so nothing was sent.\n\n` +
          `      Almost always this means the dev server was started without\n` +
          `      NEXT_PUBLIC_API_URL and picked up apps/frontend/.env.local,\n` +
          `      which points at the DEPLOYED backend. Start it with\n` +
          `      NEXT_PUBLIC_API_URL=http://localhost:4000 (see e2e/README.md),\n` +
          `      or let this config start it for you.\n`,
      );
    }
  },
});

export { expect };
