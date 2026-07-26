import { expect, test } from './fixtures';
import { login, PNG_1X1, runId } from './helpers';

/**
 * The full create-with-upload path: the product form uploads the image to the
 * backend (POST /api/v1/images), stores the returned URL on the product, and the
 * list renders that URL as a thumbnail.
 */
test('creates a product with an uploaded image and shows it in the list', async ({
  page,
}) => {
  const name = `E2E Widget ${runId()}`;

  await login(page);
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Products', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Add product' }).first().click();

  const dialog = page.getByRole('dialog', { name: 'Add product' });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('SKU').fill(`E2E-${runId()}`);
  await dialog.getByLabel('Price').fill('12.50');
  await dialog.getByLabel('Stock').fill('7');

  // The file input is visually hidden behind an "Upload image" button;
  // setInputFiles drives it directly, which is what a real pick amounts to.
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'e2e-pixel.png',
    mimeType: 'image/png',
    buffer: PNG_1X1,
  });

  // The upload finished only once the preview swaps in for the placeholder and
  // the button changes to "Replace image" — no arbitrary wait needed.
  await expect(dialog.getByRole('img', { name: 'Preview' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Replace image' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Add product' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText('Product created')).toBeVisible();

  // Search by the unique name: the list is paginated at 10 and ordered by
  // sortOrder, so a fresh product is not guaranteed to be on page 1 after
  // repeated runs. Searching makes the assertion independent of run count.
  await page.getByLabel('Search products').fill(name);

  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toHaveCount(1);
  // Prices come back from the API without trailing zeros ("12.5", not "12.50")
  // and the list appends the currency.
  await expect(row).toContainText('12.5 JOD');

  // The thumbnail: the list hides an <img> whose load errors, so requiring it to
  // be VISIBLE proves the uploaded bytes were really served back and decoded.
  // `alt=""` makes the thumbnail presentational, so it is reached by tag name
  // rather than by role.
  const thumbnail = row.locator('img');
  await expect(thumbnail).toBeVisible();
  await expect(thumbnail).toHaveAttribute(
    'src',
    /\/api\/v1\/public\/images\/[0-9a-z-]+$/i,
  );
});
