import { Router } from 'express';

/**
 * Public legal pages (Privacy Policy + Terms of Service). Served as plain HTML at
 * the top level (no JWT, no API prefix) so they can be used as the app's public
 * Privacy Policy / Terms URLs — e.g. when switching a Meta app to Live mode.
 */
const router = Router();

const LAST_UPDATED = 'July 2026';
const CONTACT_EMAIL = 'dev@thunder-haus.com';
const APP_NAME = 'AI Customer Support Platform';

function page(title: string, body: string): string {
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
  code{background:#f1f5f9;padding:.1rem .3rem;border-radius:4px}
</style>
</head>
<body>
${body}
<hr style="margin-top:2.5rem;border:none;border-top:1px solid #e2e8f0" />
<p class="muted">Contact: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> · Last updated ${LAST_UPDATED}</p>
</body>
</html>`;
}

const PRIVACY_HTML = page(
  'Privacy Policy',
  `<h1>Privacy Policy</h1>
<p class="muted">Last updated ${LAST_UPDATED}</p>
<p>${APP_NAME} ("we", "us") provides a multi-tenant customer-support platform that
lets businesses receive and reply to their customers' messages across connected
channels (Web Chat, WhatsApp, Instagram, and Facebook Messenger), with optional
AI-assisted replies. This policy explains what we process and why.</p>

<h2>Information we process</h2>
<ul>
  <li><strong>Business account data:</strong> the name, email, and role of users who sign in to operate a workspace.</li>
  <li><strong>Customer messages &amp; profile identifiers:</strong> the content of messages sent to a connected business account, and the platform-provided identifiers (e.g. a channel-scoped user ID, username, phone number, or display name) needed to route and reply to a conversation.</li>
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
  <li><strong>Messaging platforms</strong> (Meta / WhatsApp, Instagram, Facebook Messenger) to send and receive messages you have connected.</li>
  <li><strong>OpenAI</strong> to generate AI-assisted replies when a business enables that feature.</li>
  <li><strong>Cloud infrastructure</strong> (hosting and a managed PostgreSQL database) to run the service.</li>
</ul>

<h2>Data retention &amp; tenant isolation</h2>
<p>Each business's data is isolated to its own workspace and is retained while the
workspace is active. Connecting/disconnecting a channel or deleting data removes
the corresponding records. A business may request deletion of its workspace data
by contacting us.</p>

<h2>Security</h2>
<p>Traffic is served over HTTPS, channel secrets are encrypted at rest, webhook
payloads are signature-verified, and access is authenticated and tenant-scoped.</p>

<h2>Your choices</h2>
<p>Businesses control which channels are connected and can disconnect or delete
them at any time. Customers may stop messaging a connected business account at
any time through the underlying messaging platform.</p>

<h2>Contact</h2>
<p>Questions about this policy: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>`,
);

const TERMS_HTML = page(
  'Terms of Service',
  `<h1>Terms of Service</h1>
<p class="muted">Last updated ${LAST_UPDATED}</p>
<p>By accessing or using ${APP_NAME} you agree to these terms.</p>

<h2>Use of the service</h2>
<p>The service lets a business manage customer conversations across connected
messaging channels. You are responsible for the accounts and channels you
connect, for complying with the terms of each messaging platform (including
Meta's Platform Terms and Developer Policies), and for the content you send.</p>

<h2>Acceptable use</h2>
<p>You may not use the service to send spam, unlawful, or abusive content, to
violate a messaging platform's policies, or to attempt to access another
tenant's data.</p>

<h2>Data</h2>
<p>Handling of personal data is described in our
<a href="/privacy">Privacy Policy</a>.</p>

<h2>Availability &amp; disclaimer</h2>
<p>The service is provided "as is" without warranties. We are not liable for
indirect or consequential damages arising from use of the service.</p>

<h2>Contact</h2>
<p><a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>`,
);

router.get('/privacy', (_req, res) => {
  res.status(200).type('html').send(PRIVACY_HTML);
});

router.get('/terms', (_req, res) => {
  res.status(200).type('html').send(TERMS_HTML);
});

export const legalRoutes = router;
