/**
 * Facebook Messenger (Meta) types. Everything platform-specific lives inside the
 * Facebook provider — these types never leak into core modules.
 *
 * Messenger uses the webhook object "page" with `entry[].messaging[]` (the same
 * Messenger-Platform shape Instagram uses). Sending is via the connected Page's
 * messages node on graph.facebook.com: POST /{PAGE_ID}/messages with a Page
 * access token. Unlike Instagram, Messenger emits delivery (per-mid) receipts.
 */

/** Encrypted per-account secrets (stored via ChannelCredential, never returned). */
export interface FacebookCredentials {
  /** Long-lived Page access token with pages_messaging scope. */
  accessToken: string;
  /** Meta App Secret — used to verify X-Hub-Signature-256 webhook signatures. */
  appSecret: string;
  /** Verify token — echoed during the GET webhook subscription handshake. */
  verifyToken: string;
}

/** Safe, non-secret account config (stored in ChannelAccount.metadata.facebook). */
export interface FacebookConfig {
  /** Facebook Page ID — the stable routing/send identifier (also
   *  ChannelAccount.externalAccountId). */
  pageId: string;
  /** Human-readable Page name for display only. */
  pageName?: string;
  /** Business name. */
  businessName?: string;
}

// --- Meta (Messenger) webhook payload shapes: defensively partial/optional ---

export interface FacebookWebhookBody {
  object?: string; // "page"
  entry?: FacebookEntry[];
}

export interface FacebookEntry {
  id?: string; // the recipient Page id
  time?: number;
  messaging?: FacebookMessagingEvent[];
}

export interface FacebookMessagingEvent {
  sender?: { id?: string }; // PSID of the customer (or Page, on echoes)
  recipient?: { id?: string }; // Page id
  timestamp?: number; // unix millis
  message?: FacebookInboundMessage;
  delivery?: { mids?: string[]; watermark?: number };
  read?: { watermark?: number };
  reaction?: { mid?: string; action?: string; emoji?: string };
  postback?: { mid?: string; title?: string; payload?: string };
}

export interface FacebookInboundMessage {
  mid?: string; // message id
  text?: string;
  is_echo?: boolean; // true when the Page is the sender
  attachments?: FacebookAttachment[];
  reply_to?: { mid?: string };
}

export interface FacebookAttachment {
  type?: string; // image | video | audio | file | template | fallback | …
  payload?: { url?: string };
}

// --- Graph API response shapes ---

/** Successful send response: POST /{PAGE_ID}/messages. */
export interface FacebookSendResponse {
  recipient_id?: string;
  message_id?: string;
}

/** Page/health response: GET /{PAGE_ID}?fields=id,name. */
export interface FacebookPageResponse {
  id?: string;
  name?: string;
}

/** Graph API error envelope. */
export interface MetaGraphError {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}
