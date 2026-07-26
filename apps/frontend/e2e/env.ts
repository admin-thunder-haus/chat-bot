/**
 * Shared configuration for the end-to-end suite, plus the LOCAL-ONLY guard.
 *
 * This suite writes real data (products, images, messages) through the real API.
 * It must therefore NEVER be pointed at the deployed backend
 * (https://ai-support-backend-hpub.onrender.com) or at the Neon database behind
 * it. `assertLocal` enforces that: any non-loopback host aborts the run before a
 * single browser is launched, with an explanation instead of a stack trace.
 *
 * Every value comes from an environment variable with a local default, so no
 * credential or URL is hardcoded anywhere in a spec.
 */

/** Hostnames that can only ever be this machine. */
export const LOCAL_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
]);

/** True when an absolute URL points at this machine. Unparseable URLs are not. */
export function isLocalUrl(raw: string): boolean {
  try {
    const hostname = new URL(raw).hostname.replace(/^\[|\]$/g, '');
    return LOCAL_HOSTNAMES.has(hostname);
  } catch {
    return false;
  }
}

function assertLocal(varName: string, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `[e2e] ${varName} is not a valid absolute URL: ${JSON.stringify(raw)}\n` +
        `      Expected something like http://localhost:3000`,
    );
  }

  // `new URL('http://[::1]:4000').hostname` keeps the brackets — strip them.
  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  if (!LOCAL_HOSTNAMES.has(hostname)) {
    throw new Error(
      `\n[e2e] REFUSING TO RUN — ${varName} is not a local address.\n` +
        `      Got:      ${url.origin}\n` +
        `      Expected: a loopback host (${[...LOCAL_HOSTNAMES].join(', ')})\n\n` +
        `      This suite creates and modifies real records (products, uploaded\n` +
        `      images, sent messages). It is only ever allowed to run against a\n` +
        `      LOCAL backend on a LOCAL, seeded database — never the deployed\n` +
        `      Render backend and never the Neon production database.\n\n` +
        `      Unset ${varName} (or set it to a localhost URL) and try again.\n`,
    );
  }

  // Normalised: no trailing slash, so `${apiUrl}/api/v1/...` is always correct.
  return url.origin;
}

/** Frontend origin under test. */
export const BASE_URL = assertLocal(
  'E2E_BASE_URL',
  process.env.E2E_BASE_URL || 'http://localhost:3000',
);

/**
 * Backend origin the frontend talks to. Used for the guard above and passed to
 * the dev server as NEXT_PUBLIC_API_URL, so the browser and the guard can never
 * disagree about which API is in play.
 */
export const API_URL = assertLocal(
  'E2E_API_URL',
  process.env.E2E_API_URL || 'http://localhost:4000',
);

/** Seeded demo credentials (apps/backend/prisma/seed.ts). */
export const EMAIL = process.env.E2E_EMAIL || 'owner@demo.com';
export const PASSWORD = process.env.E2E_PASSWORD || 'Demo12345';
