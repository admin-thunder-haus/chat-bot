import { expect, test } from './fixtures';
import { login, runId } from './helpers';

/**
 * The seed DOES provide conversations (apps/backend/prisma/seed.ts, seedDay3),
 * so no mock-inbound setup is needed. "Pricing question" is chosen on purpose:
 * it is a MANUAL conversation with no channel account, so the outgoing pipeline
 * persists and sends it locally instead of calling a provider API with the
 * seed's deliberately fake WhatsApp credentials.
 */
const SEEDED_SUBJECT = 'Pricing question';

test('opens a seeded conversation, sends a reply and sees it in the thread', async ({
  page,
}) => {
  const reply = `E2E reply ${runId()}`;

  await login(page);
  await page.getByRole('link', { name: 'Inbox', exact: true }).click();

  // Narrow the list to one known conversation so the spec never depends on
  // which seeded thread happens to be most recent.
  await page.getByLabel('Search conversations').fill(SEEDED_SUBJECT);

  const conversation = page
    .getByRole('button')
    .filter({ hasText: SEEDED_SUBJECT });
  await expect(conversation).toHaveCount(1);
  await conversation.click();

  // The thread pane is open once the message log has rendered.
  const thread = page.getByRole('log', { name: 'Conversation messages' });
  await expect(thread).toBeVisible();
  await expect(thread).toContainText('I want to know your prices');

  // `exact` matters: the message log is labelled "Conversation messages", which
  // a substring match on "Message" would also hit.
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill(reply);
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  // The sent message appears in the thread, and the composer is cleared.
  await expect(thread).toContainText(reply);
  await expect(composer).toHaveValue('');

  // It is a real outbound message, not just optimistic local state: reload and
  // it is still there, served from the API.
  await page.reload();
  const reloaded = page.getByRole('log', { name: 'Conversation messages' });
  await expect(reloaded).toContainText(reply);
});
