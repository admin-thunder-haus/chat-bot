/**
 * Instagram Messaging (Meta) types. Everything platform-specific lives inside
 * the Instagram provider — these types never leak into core modules.
 *
 * Instagram DMs use the Messenger-Platform webhook shape (object: "instagram",
 * `entry[].messaging[]`), NOT the WhatsApp `entry[].changes[]` shape. Sending
 * uses the Graph API messages node for the connected Instagram professional
 * account: POST /{IG_ID}/messages { recipient:{id}, message:{text} }.
 */

/** Encrypted per-account secrets (stored via ChannelCredential, never returned). */
export interface InstagramCredentials {
  /** Long-lived Page/IG access token with instagram_manage_messages scope. */
  accessToken: string;
  /** Meta App Secret — used to verify X-Hub-Signature-256 webhook signatures. */
  appSecret: string;
  /** Verify token — echoed during the GET webhook subscription handshake. */
  verifyToken: string;
}

/** Safe, non-secret account config (stored in ChannelAccount.metadata.instagram). */
export interface InstagramConfig {
  /** Instagram professional account ID — the stable routing/send identifier
   *  (also the ChannelAccount.externalAccountId). NEVER the @username. */
  instagramAccountId: string;
  /** Linked Facebook Page ID (also the ChannelAccount.externalPageId). */
  facebookPageId?: string;
  /** Human-readable @username for display only (never a routing key). */
  instagramUsername?: string;
  /** Verified business name. */
  businessName?: string;
}

// --- Meta (Instagram) webhook payload shapes: defensively partial/optional ---

export interface InstagramWebhookBody {
  object?: string; // "instagram"
  entry?: InstagramEntry[];
}

export interface InstagramEntry {
  id?: string; // the recipient IG business account id
  time?: number;
  /** Messenger-style events (Instagram-via-Facebook-Login / older delivery). */
  messaging?: InstagramMessagingEvent[];
  /** Changes-style events (Instagram API with Instagram Login). The `value`
   *  carries the same sender/recipient/message shape as a messaging event. */
  changes?: InstagramChange[];
}

export interface InstagramChange {
  field?: string; // "messages"
  value?: InstagramMessagingEvent;
}

/** A single Messenger-style messaging event (message / read / postback / …). */
export interface InstagramMessagingEvent {
  sender?: { id?: string }; // IGSID of the customer (or business, on echoes)
  recipient?: { id?: string }; // IG business account id
  timestamp?: number; // unix millis
  message?: InstagramInboundMessage;
  read?: { mid?: string }; // read receipt referencing a sent message id
  reaction?: { mid?: string; action?: string; emoji?: string };
  postback?: { mid?: string; title?: string; payload?: string };
}

export interface InstagramInboundMessage {
  mid?: string; // message id (wamid-equivalent)
  text?: string;
  is_echo?: boolean; // true when the business account is the sender
  is_deleted?: boolean;
  attachments?: InstagramAttachment[];
  reply_to?: { mid?: string }; // referenced message when replying
}

export interface InstagramAttachment {
  type?: string; // image | video | audio | file | share | story_mention | …
  payload?: { url?: string };
}

// --- Graph API response shapes ---

/** Successful send response: POST /{IG_ID}/messages. */
export interface InstagramSendResponse {
  recipient_id?: string;
  message_id?: string;
}

/** Profile/health response: GET /{IG_ID}?fields=id,username,name. */
export interface InstagramAccountResponse {
  id?: string;
  username?: string;
  name?: string;
}

/** Graph API error envelope (same shape across Meta products). */
export interface MetaGraphError {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}
