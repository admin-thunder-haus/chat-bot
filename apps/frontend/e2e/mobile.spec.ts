import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { login } from './helpers';

/**
 * docs/DESIGN-SYSTEM.md §5: "No horizontal page scroll at 375px." Wide content
 * (tables, filter strips) is explicitly ALLOWED to scroll inside its own
 * `overflow-x-auto` container, so this asserts on the DOCUMENT and nothing else:
 *
 *   document.documentElement.scrollWidth <= document.documentElement.clientWidth
 *
 * Two tests, each sweeping its pages with `expect.soft` rather than one test per
 * page: the signed-in one logs in once (the backend's auth limiter is
 * deliberately strict) and a page that does overflow is still reported without
 * hiding the pages after it. The split is by SESSION, not by convenience — the
 * public auth pages must be measured without a session (see PUBLIC_PAGES).
 *
 * REGRESSION IT ALREADY CAUGHT — this test first failed on Products and Services
 * (scrollWidth 390 vs clientWidth 375). Cause: `Toolbar`'s `filters` wrapper in
 * components/ui.tsx used `[&>*]:w-full`, and that child-combinator selector
 * outranked Tailwind's `.sr-only { width: 1px }` — so the visually hidden
 * `<label className="sr-only">` each page passes alongside its filter control
 * became a 375px-wide absolutely-positioned box starting 15px in from the left,
 * 15px past the viewport. Fixed in ui.tsx by narrowing the selector to
 * `[&>*:not(.sr-only)]:w-full`. Keep this spec pointed at the document, not at
 * inner containers, and it stays the guard against that class of bug.
 */
test.use({ viewport: { width: 375, height: 812 } });

interface Target {
  name: string;
  path: string;
  /** `<h1>` text proving the page finished loading; null when it has none. */
  heading: string | null;
}

/** Pages behind the dashboard shell — measured in a signed-in session. */
const DASHBOARD_PAGES: Target[] = [
  { name: 'Overview', path: '/dashboard', heading: 'Overview' },
  { name: 'Inbox', path: '/dashboard/inbox', heading: null },
  { name: 'Products', path: '/dashboard/products', heading: 'Products' },
  { name: 'Services', path: '/dashboard/services', heading: 'Services' },
  { name: 'Channels', path: '/dashboard/channels', heading: 'Channels' },
  {
    name: 'Company profile',
    path: '/dashboard/profile',
    heading: 'Company profile',
  },
];

/**
 * Public, pre-auth pages. These are measured in their own test so they run in a
 * FRESH browser context with no session cookie — each of them redirects to
 * /dashboard once `useAuth` reports a signed-in user, which would measure the
 * wrong page entirely. Playwright gives every test its own context, so keeping
 * these out of the signed-in test above is the whole mechanism.
 *
 * `/reset-password` renders its form purely from the `?token=` query param and
 * makes no network call until the form is submitted, so an obviously-invalid
 * dummy token is enough to lay the page out. This spec measures LAYOUT only and
 * never submits — nothing here attempts an actual password reset.
 */
const PUBLIC_PAGES: Target[] = [
  { name: 'Login', path: '/login', heading: 'Welcome back' },
  {
    name: 'Forgot password',
    path: '/forgot-password',
    heading: 'Reset your password',
  },
  {
    name: 'Reset password',
    path: '/reset-password?token=smoke-test-invalid-token',
    heading: 'Choose a new password',
  },
];

/** Measures one page and records a soft failure if the DOCUMENT overflows. */
async function measure(page: Page, target: Target): Promise<void> {
  await test.step(`${target.name} (${target.path})`, async () => {
    await page.goto(target.path);

    // Measure the loaded page, not a skeleton: a placeholder is narrower than
    // the real content, so measuring early could mask a genuine overflow.
    if (target.heading) {
      await expect(
        page.getByRole('heading', { name: target.heading, level: 1 }),
      ).toBeVisible();
    } else {
      // The inbox has no <h1>; its search field is the loaded signal.
      await expect(page.getByLabel('Search conversations')).toBeVisible();
    }

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    // Soft so every page is measured even once one has failed.
    expect
      .soft(
        scrollWidth,
        `${target.name} (${target.path}) scrolls horizontally at 375px: ` +
          `documentElement.scrollWidth=${scrollWidth} > clientWidth=${clientWidth}`,
      )
      .toBeLessThanOrEqual(clientWidth);
  });
}

test('no horizontal page scroll at 375px on the main dashboard pages', async ({
  page,
}) => {
  await login(page);

  for (const target of DASHBOARD_PAGES) {
    await measure(page, target);
  }
});

test('no horizontal page scroll at 375px on the public auth pages', async ({
  page,
}) => {
  // Deliberately no login() — see PUBLIC_PAGES.
  for (const target of PUBLIC_PAGES) {
    await measure(page, target);
  }
});
