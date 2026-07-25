/**
 * Actionable operator messages for the Meta Graph API error codes that actually
 * show up in production (WhatsApp Cloud API, Messenger, Instagram all share the
 * same error envelope). Shared by the Meta providers' error mappers so a
 * delivery failure tells the operator WHAT TO DO instead of "Meta error 133010".
 *
 * This file only translates codes to text: it never changes retry semantics or
 * failure codes — the classifiers own those.
 */

/** The Meta error envelope every Graph API error response carries. */
interface MetaErrorEnvelope {
  error?: { code?: number; error_subcode?: number; message?: string };
}

const META_ERROR_MESSAGES: Record<number, string> = {
  // --- Token / app level ---
  102: 'Access token expired or invalid — reconnect the channel',
  190: 'Access token expired or invalid — reconnect the channel',
  // --- WhatsApp Cloud API number setup ---
  133005:
    'WhatsApp two-step verification PIN is wrong — re-enter the number PIN in Meta',
  133006:
    'WhatsApp phone number must be verified before it can send — finish number verification in Meta',
  133010:
    'WhatsApp phone number is not registered for the Cloud API — complete number registration in Meta',
  // --- WhatsApp messaging rules ---
  131026: 'Recipient phone number is not a valid WhatsApp user',
  131030: "Recipient is not in the app's allowed test-numbers list",
  131047:
    'Cannot send: the 24-hour customer service window has expired — the customer must message again, or use an approved template',
  131049:
    'Meta throttled this message to protect the user experience — try again later',
  131051: 'This message type is not supported for this recipient',
  // --- Messenger / Instagram messaging rules ---
  10: 'The app is missing a required Meta permission for this action',
  200: 'The app is missing a required Meta permission for this action',
};

/** The numeric Meta error code carried by a Graph API error body, if any. */
export function metaErrorCode(json: unknown): number | undefined {
  const code = (json as MetaErrorEnvelope | null)?.error?.code;
  return typeof code === 'number' ? code : undefined;
}

/**
 * A safe, operator-actionable summary of a Graph API error. Known codes get a
 * "what to do" sentence with the numeric code kept in the tail for support;
 * unknown codes keep the previous `Meta error <code>` shape, and a body without
 * a code falls back to the caller's generic message. Never leaks tokens or raw
 * provider internals.
 */
export function describeMetaError(json: unknown, fallback: string): string {
  const code = metaErrorCode(json);
  if (code === undefined) return fallback;
  const known = META_ERROR_MESSAGES[code];
  return known ? `${known} (Meta error ${code})` : `Meta error ${code}`;
}
