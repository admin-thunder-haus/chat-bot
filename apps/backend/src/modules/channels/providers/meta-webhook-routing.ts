import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WebhookTargetGroup } from './channel-provider.interface';

/**
 * Splitting a Meta webhook payload by destination account.
 *
 * Every Meta product posts the same envelope — `{ object, entry: [...] }` — and
 * a single POST may legitimately carry entries for SEVERAL of our tenants,
 * because one platform app serves all of them behind one callback URL. Handing
 * the whole payload to one account would attribute another tenant's messages to
 * it, so the engine needs the payload cut into per-account slices before
 * anything is parsed.
 *
 * Shared by the three Meta providers because the envelope is identical; only
 * the ids that identify an account differ, which is what `idsForEntry` supplies.
 */

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Cut `{ object, entry: [...] }` into one group per entry.
 *
 * One group PER ENTRY rather than per account: entries are the unit Meta
 * batches by, and keeping them separate means a payload mixing two tenants
 * produces two independently-resolved slices. Entries whose ids cannot be read
 * are dropped — an event we cannot attribute to an account must not be
 * attributed to an arbitrary one.
 */
export function splitMetaWebhookByEntry(
  body: unknown,
  idsForEntry: (entry: Record<string, unknown>) => (string | undefined)[],
): WebhookTargetGroup[] {
  const root = asRecord(body);
  const entries = root?.entry;
  if (!Array.isArray(entries)) return [];

  const groups: WebhookTargetGroup[] = [];
  for (const raw of entries) {
    const entry = asRecord(raw);
    if (!entry) continue;
    const externalIds = [...new Set(idsForEntry(entry).filter((v): v is string => Boolean(v)))];
    if (externalIds.length === 0) continue;
    groups.push({
      externalIds,
      // Rebuild the envelope around this entry alone, so the provider's own
      // parseWebhook sees exactly the shape it already expects.
      body: { ...root, entry: [entry] },
    });
  }
  return groups;
}

/**
 * Verify `X-Hub-Signature-256` against the platform app secret.
 *
 * Identical across Messenger, Instagram and WhatsApp — Meta signs every product
 * the same way — so the three providers delegate here rather than each carrying
 * a copy of the HMAC. Constant-time, and length-checked first because
 * timingSafeEqual throws on a length mismatch.
 */
export function validateMetaSharedSignature(input: {
  rawBody: Buffer;
  headers: Record<string, string | undefined>;
  appSecret: string;
}): boolean {
  const header = input.headers['x-hub-signature-256'];
  if (!header || !header.startsWith('sha256=')) return false;
  const provided = Buffer.from(header.slice('sha256='.length));
  const expected = Buffer.from(
    createHmac('sha256', input.appSecret).update(input.rawBody).digest('hex'),
  );
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/**
 * Turn a node's subscribed-app list into an inbound-readiness verdict.
 *
 * Membership is checked against META_APP_ID, not merely "the list is non-empty".
 * The real failure looked like this: the WABA was subscribed to Meta's own
 * `WA DevX Webhook Events 1P App` and not to ours, so a non-empty list would
 * have reported everything fine while nothing was delivered.
 *
 * Returns null — "cannot tell" — rather than false whenever the answer is
 * genuinely unknown: the API call failed, or no app id is configured (which is
 * normal for a customer connecting with their own Meta app, where our id would
 * legitimately be absent). Reporting those as broken would be a false alarm,
 * and one false alarm makes every later warning ignorable.
 */
export function interpretSubscribedApps(
  ids: string[] | null,
): { ready: boolean | null; detail?: string } {
  if (ids === null) return { ready: null, detail: 'UNKNOWN' };
  const appId = process.env.META_APP_ID;
  if (!appId) {
    // No platform app to look for. An empty list is still conclusive: nothing
    // at all is subscribed, so nothing can possibly be delivered.
    return ids.length === 0
      ? { ready: false, detail: 'NO_SUBSCRIBERS' }
      : { ready: null, detail: 'UNKNOWN' };
  }
  return ids.includes(appId)
    ? { ready: true }
    : { ready: false, detail: 'APP_NOT_SUBSCRIBED' };
}

/** Messenger / Instagram: the entry id IS the Page / Instagram account id. */
export function splitMetaMessagingWebhook(body: unknown): WebhookTargetGroup[] {
  return splitMetaWebhookByEntry(body, (entry) => [str(entry.id)]);
}

/**
 * WhatsApp: the entry id is the WABA, but an account is stored by its phone
 * number id. Both are offered — a WABA with several numbers would otherwise
 * resolve to whichever number happened to be stored first.
 */
export function splitWhatsAppWebhook(body: unknown): WebhookTargetGroup[] {
  return splitMetaWebhookByEntry(body, (entry) => {
    const ids: (string | undefined)[] = [];
    const changes = entry.changes;
    if (Array.isArray(changes)) {
      for (const change of changes) {
        const value = asRecord(asRecord(change)?.value);
        const metadata = asRecord(value?.metadata);
        ids.push(str(metadata?.phone_number_id));
      }
    }
    // The WABA id last: it is the weaker match, used only when no phone number
    // id was present in the payload.
    ids.push(str(entry.id));
    return ids;
  });
}
