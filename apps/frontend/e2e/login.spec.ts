import { expect, test } from './fixtures';
import { EMAIL, PASSWORD } from './env';

/**
 * The gate every other spec depends on: the seeded demo account can sign in and
 * lands on the dashboard overview with its session established.
 */
test('signs in with the seeded credentials and lands on the dashboard', async ({
  page,
}) => {
  await page.goto('/login');

  await expect(
    page.getByRole('heading', { name: 'Welcome back' }),
  ).toBeVisible();

  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);

  // The overview page itself, not just the URL — proves the layout's auth check
  // passed and /auth/me resolved rather than bouncing back to /login.
  await expect(
    page.getByRole('heading', { name: 'Overview', level: 1 }),
  ).toBeVisible();
  await expect(page.getByText('Signed in as')).toBeVisible();

  // The nav shell is present, so the session survived the client-side redirect.
  await expect(
    page.getByRole('link', { name: 'Inbox', exact: true }),
  ).toBeVisible();
});
