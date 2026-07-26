import { expect, test } from './fixtures';
import { login } from './helpers';

/**
 * docs/DESIGN-SYSTEM.md §5: "No horizontal page scroll at 375px." Wide content
 * (tables, filter strips) is explicitly ALLOWED to scroll inside its own
 * `overflow-x-auto` container, so this asserts on the DOCUMENT and nothing else:
 *
 *   document.documentElement.scrollWidth <= document.documentElement.clientWidth
 *
 * One test that sweeps every page with `expect.soft`, rather than one test per
 * page: it signs in once (the backend's auth limiter is deliberately strict) and
 * a page that does overflow is still reported without hiding the pages after it.
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

const PAGES: Target[] = [
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

test('no horizontal page scroll at 375px on the main dashboard pages', async ({
  page,
}) => {
  await login(page);

  for (const target of PAGES) {
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
});
