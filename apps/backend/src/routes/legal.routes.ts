import { Router } from 'express';
import { env } from '../config/env';

/**
 * Public legal pages (Privacy Policy + Terms of Service). Served as plain HTML at
 * the top level (no JWT, no API prefix) so they can be used as the app's public
 * Privacy Policy / Terms URLs — e.g. when switching a Meta app to Live mode, and
 * as the links every EU customer will ask for.
 *
 * ⚠ THIS IS A TEMPLATE, NOT LEGAL ADVICE.
 *
 * The wording below describes what this platform actually does technically, which
 * is the part an engineer can state accurately. The parts specific to the
 * BUSINESS — legal entity name, registered address, contact address, retention
 * period, governing law — are NOT invented here. They come from env vars, and
 * until each one is set the page renders a loud, visible `[ FILL IN: … ]`
 * placeholder inline, plus a banner at the top listing what is still missing.
 *
 * That is deliberate: a policy that quietly says "we" and names no legal entity
 * looks finished and is not. Making the gaps impossible to miss — for the owner
 * AND for anyone reviewing the app — is safer than a plausible-sounding blank.
 *
 * See docs/LAUNCH-CHECKLIST.md for the values to fill in.
 */
const router = Router();

const APP_NAME = 'AI Customer Support Platform';

/** One blank the owner must fill in, and the env var that fills it. */
interface Blank {
  envVar: string;
  label: string;
  value: string | undefined;
}

function blanks(): Record<
  'entity' | 'address' | 'contact' | 'retention' | 'jurisdiction',
  Blank
> {
  return {
    entity: {
      envVar: 'LEGAL_ENTITY_NAME',
      label: 'Registered legal name of the company operating this service',
      value: env.LEGAL_ENTITY_NAME,
    },
    address: {
      envVar: 'LEGAL_ENTITY_ADDRESS',
      label: 'Registered business address',
      value: env.LEGAL_ENTITY_ADDRESS,
    },
    contact: {
      envVar: 'LEGAL_CONTACT_EMAIL',
      label: 'Contact address for privacy and data requests',
      value: env.LEGAL_CONTACT_EMAIL,
    },
    retention: {
      envVar: 'LEGAL_DATA_RETENTION',
      label: 'How long data is kept after an account closes (e.g. "30 days")',
      value: env.LEGAL_DATA_RETENTION,
    },
    jurisdiction: {
      envVar: 'LEGAL_JURISDICTION',
      label: 'Country whose law governs these terms (e.g. "Jordan")',
      value: env.LEGAL_JURISDICTION,
    },
  };
}

/** Escape before interpolating: every one of these values is operator input. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A filled value, or a placeholder that cannot be misread as final text. */
function fill(blank: Blank): string {
  const value = blank.value?.trim();
  if (value) return escapeHtml(value);
  return `<mark class="todo">[ FILL IN: ${escapeHtml(blank.label)} — set ${blank.envVar} ]</mark>`;
}

/** Banner listing what is still unset. Renders nothing once all are filled. */
function todoBanner(pending: Blank[]): string {
  if (pending.length === 0) return '';
  const items = pending
    .map((b) => `<li><code>${b.envVar}</code> — ${escapeHtml(b.label)}</li>`)
    .join('');
  return `<div class="banner">
  <strong>This document is not finished.</strong>
  <p>It is a template. The values below are still unset and appear as highlighted
  placeholders in the text. Set them as environment variables on the server, then
  reload this page — see <code>docs/LAUNCH-CHECKLIST.md</code>.</p>
  <ul>${items}</ul>
</div>`;
}

function page(title: string, body: string): string {
  const all = blanks();
  const pending = Object.values(all).filter((b) => !b.value?.trim());
  const email = all.contact.value?.trim();
  const contactLine = email
    ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`
    : fill(all.contact);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — ${APP_NAME}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:0 auto;padding:2rem 1.25rem;color:#1e293b;line-height:1.65}
  h1{font-size:1.6rem;margin-bottom:.25rem}
  h2{font-size:1.1rem;margin-top:1.75rem}
  .muted{color:#64748b;font-size:.9rem}
  a{color:#2563eb}
  code{background:#f1f5f9;padding:.1rem .3rem;border-radius:4px;font-size:.9em}
  mark.todo{background:#fef08a;color:#78350f;font-weight:600;padding:.05rem .25rem;border-radius:3px}
  .banner{border:2px solid #f59e0b;background:#fffbeb;border-radius:8px;padding:1rem 1.25rem;margin-bottom:2rem}
  .banner p{margin:.5rem 0}
  .banner ul{margin:.5rem 0 0;padding-left:1.25rem}
</style>
</head>
<body>
${todoBanner(pending)}
${body}
<hr style="margin-top:2.5rem;border:none;border-top:1px solid #e2e8f0" />
<p class="muted">Contact: ${contactLine} · Last updated ${escapeHtml(env.LEGAL_LAST_UPDATED)}</p>
</body>
</html>`;
}

function privacyHtml(): string {
  const b = blanks();
  return page(
    'Privacy Policy',
    `<h1>Privacy Policy</h1>
<p class="muted">Last updated ${escapeHtml(env.LEGAL_LAST_UPDATED)}</p>
<p>This service is operated by ${fill(b.entity)}, ${fill(b.address)} ("we",
"us"). We provide a multi-tenant customer-support platform that lets businesses
receive and reply to their customers' messages across connected channels (Web
Chat, WhatsApp, Instagram, Facebook Messenger and Telegram), with optional
AI-assisted replies. This policy explains what we process and why.</p>

<h2>Information we process</h2>
<ul>
  <li><strong>Business account data:</strong> the name, email, and role of users who sign in to operate a workspace, plus a record of sign-in attempts (time, IP address, browser) kept as a security measure.</li>
  <li><strong>Customer messages &amp; profile identifiers:</strong> the content of messages sent to a connected business account, and the platform-provided identifiers (e.g. a channel-scoped user ID, username, phone number, or display name) needed to route and reply to a conversation.</li>
  <li><strong>Uploaded business content:</strong> documents, images and catalogue data a business uploads so the assistant can answer from them.</li>
  <li><strong>Channel credentials:</strong> access tokens and secrets you provide to connect a channel are stored <strong>encrypted at rest</strong> and are never displayed back or shared.</li>
  <li><strong>Operational metadata:</strong> timestamps, delivery/health status, and request identifiers used to operate and troubleshoot the service.</li>
</ul>

<h2>How we use it</h2>
<p>Data is used solely to deliver the customer-support service for the business
that owns the workspace: routing incoming messages to that business's inbox,
sending replies, generating optional AI responses from the business's own
knowledge, and monitoring channel health. We do not sell personal data or use it
for advertising.</p>

<h2>Third-party processors</h2>
<ul>
  <li><strong>Messaging platforms</strong> (Meta — WhatsApp, Instagram, Facebook Messenger; Telegram) to send and receive messages you have connected.</li>
  <li><strong>OpenAI</strong> to generate AI-assisted replies and to transcribe inbound voice notes, when a business enables those features.</li>
  <li><strong>Cloud infrastructure</strong> (application hosting and a managed PostgreSQL database) to run the service.</li>
  <li><strong>Email delivery</strong> for account verification, password resets and notifications.</li>
  <li><strong>Error monitoring</strong> to record server faults. Request data is scrubbed of credentials and contact details before being recorded.</li>
</ul>

<h2>Data retention &amp; tenant isolation</h2>
<p>Each business's data is isolated to its own workspace and is retained while the
workspace is active. After an account is closed, data is deleted within
${fill(b.retention)}. A business may also delete its entire workspace at any time
from the dashboard, which permanently removes all of its data immediately, and
may export its data as a machine-readable file beforehand.</p>

<h2>Security</h2>
<p>Traffic is served over HTTPS, channel secrets are encrypted at rest, passwords
are stored only as salted hashes, webhook payloads are signature-verified, and
access is authenticated and tenant-scoped.</p>

<h2>Your rights</h2>
<p>Depending on where you are located, you may have the right to access, correct,
export or delete your personal data, and to object to or restrict its processing.
Businesses can exercise access, export and deletion directly from the dashboard.
For anything else — including a request from an individual whose messages were
handled by a business using this service — contact ${fill(b.contact)}. We respond
within the period required by applicable law.</p>

<h2>Contact</h2>
<p>Questions about this policy: ${fill(b.contact)}.</p>`,
  );
}

/**
 * Standalone data-deletion instructions.
 *
 * Meta requires a "User data deletion" URL to publish an app, and rejects one
 * that merely repeats the privacy policy URL. More usefully, it is the page a
 * reviewer actually reads to check the deletion route is real — so this
 * describes the two paths that genuinely exist in the product (a business
 * deleting its own workspace, and an end customer asking the business), rather
 * than being a URL that exists only to satisfy a form.
 */
function dataDeletionHtml(): string {
  const b = blanks();
  return page(
    'Deleting your data',
    `<h1>Deleting your data</h1>
<p class="muted">Last updated ${escapeHtml(env.LEGAL_LAST_UPDATED)}</p>
<p>How to have data held by ${APP_NAME} deleted. See also our
<a href="/privacy">Privacy Policy</a>.</p>

<h2>If you use the dashboard (a business)</h2>
<p>Sign in and open <strong>Company Profile</strong>. The danger zone at the
bottom of that page deletes your entire workspace: users, customers,
conversations, messages, uploaded files and connected channels. It is immediate
and permanent, and it cannot be undone. Export your data first from the same
page if you want a copy — you will not be able to retrieve it afterwards.</p>
<p>Disconnecting a channel on the <strong>Channels</strong> page removes that
channel's stored access tokens on its own, without deleting the workspace.</p>

<h2>If you messaged a business that uses ${APP_NAME}</h2>
<p>Your messages belong to the conversation you had with that business, and the
business controls them. Ask the business directly and it can delete the
conversation from its inbox, which removes the messages permanently.</p>
<p>If you cannot reach them, contact ${fill(b.contact)} with the name of the
business and the channel you used (WhatsApp, Instagram, Messenger, Telegram or
their website chat), and we will act on the request within the period required
by applicable law.</p>

<h2>Revoking access instead</h2>
<p>Removing this app from a connected Facebook Page, Instagram account or
WhatsApp Business Account stops all further data being received. It does not by
itself delete what was already stored — use one of the routes above for that.</p>

<h2>Retention</h2>
<p>After an account is closed, remaining data is deleted within
${fill(b.retention)}.</p>

<h2>Contact</h2>
<p>${fill(b.contact)}</p>`,
  );
}

function termsHtml(): string {
  const b = blanks();
  return page(
    'Terms of Service',
    `<h1>Terms of Service</h1>
<p class="muted">Last updated ${escapeHtml(env.LEGAL_LAST_UPDATED)}</p>
<p>These terms are an agreement between you and ${fill(b.entity)} governing your
use of ${APP_NAME}. By accessing or using the service you agree to them.</p>

<h2>Use of the service</h2>
<p>The service lets a business manage customer conversations across connected
messaging channels. You are responsible for the accounts and channels you
connect, for complying with the terms of each messaging platform (including
Meta's Platform Terms and Developer Policies, and Telegram's bot terms), for the
content you send, and for having a lawful basis to process the customer data you
bring into the service.</p>

<h2>Acceptable use</h2>
<p>You may not use the service to send spam, unlawful, or abusive content, to
violate a messaging platform's policies, or to attempt to access another tenant's
data.</p>

<h2>AI-assisted replies</h2>
<p>Automatic replies are generated from the information you provide and can be
wrong or incomplete. You remain responsible for what is sent from your account.
Review the assistant's configuration before enabling automatic replies, and do
not rely on it for advice that requires a qualified professional.</p>

<h2>Fees</h2>
<p>Fees, if any, are as agreed separately in writing with you.</p>

<h2>Your data</h2>
<p>You retain ownership of your data. Handling of personal data is described in
our <a href="/privacy">Privacy Policy</a>. You can export your data, and delete
your workspace, from the dashboard at any time.</p>

<h2>Termination</h2>
<p>You may stop using the service and delete your workspace at any time. We may
suspend or terminate an account that breaches these terms.</p>

<h2>Availability &amp; disclaimer</h2>
<p>The service is provided "as is" without warranties of any kind. We do not
guarantee uninterrupted availability, and third-party messaging platforms may
change or restrict their APIs at any time.</p>

<h2>Limitation of liability</h2>
<p>To the fullest extent permitted by law, we are not liable for indirect,
incidental or consequential damages, or for lost profits or data, arising from
use of the service.</p>

<h2>Governing law</h2>
<p>These terms are governed by the laws of ${fill(b.jurisdiction)}, and the courts
of that jurisdiction have exclusive jurisdiction over any dispute.</p>

<h2>Changes</h2>
<p>We may update these terms; material changes will be communicated to the email
address on the account.</p>

<h2>Contact</h2>
<p>${fill(b.contact)}.</p>`,
  );
}

// Rendered per request rather than cached at module load: the pages must reflect
// the env of the RUNNING process, so filling a blank and restarting is all the
// owner has to do — and a stale cached copy of an unfinished policy is exactly
// the thing that would go unnoticed.
router.get('/privacy', (_req, res) => {
  res.status(200).type('html').send(privacyHtml());
});

router.get('/terms', (_req, res) => {
  res.status(200).type('html').send(termsHtml());
});

// Meta requires this as its own URL to publish an app, and rejects one that is
// merely the privacy policy URL repeated.
router.get('/data-deletion', (_req, res) => {
  res.status(200).type('html').send(dataDeletionHtml());
});

export const legalRoutes = router;
