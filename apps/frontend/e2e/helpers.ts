import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { EMAIL, PASSWORD } from './env';

/**
 * Signs in with the seeded credentials and waits until the dashboard shell has
 * rendered. Every spec starts from here — the dashboard layout redirects to
 * /login until the session is established, so navigating straight to a
 * protected page without this would race the auth bootstrap.
 */
export async function login(page: Page): Promise<void> {
  await page.goto('/login');

  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
}

/**
 * A real 1x1 red PNG (69 bytes) built in memory rather than committed as a
 * binary fixture: signature + IHDR + deflated IDAT + IEND, all CRCs valid, so
 * the browser genuinely decodes and paints it. The product list hides an <img>
 * whose load fails, so "the thumbnail is visible" is only true for a valid file.
 */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mNgYPgPAAEDAQA2dBFAAAAAAElFTkSuQmCC',
  'base64',
);

/** A unique-per-run suffix so repeated runs never collide on a name. */
export function runId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
