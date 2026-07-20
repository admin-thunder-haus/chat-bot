/**
 * WhatsApp Business Cloud API (Meta) types. Everything platform-specific lives
 * inside the WhatsApp provider — these types never leak into core modules.
 */

/** Encrypted per-account secrets (stored via ChannelCredential, never returned). */
export interface WhatsAppCredentials {
  /** Long-lived access token (System User token) for the Graph API. */
  accessToken: string;
  /** Meta App Secret — used to verify X-Hub-Signature-256 webhook signatures. */
  appSecret: string;
  /** Verify token — echoed during the GET webhook subscription handshake. */
  verifyToken: string;
}

/** Safe, non-secret account config (stored in ChannelAccount.metadata.whatsapp). */
export interface WhatsAppConfig {
  /** Phone Number ID (routing key; also the account's externalAccountId). */
  phoneNumberId: string;
  /** WhatsApp Business Account (WABA) ID (also externalPageId). */
  wabaId: string;
  /** Human-readable phone number, e.g. "+1 555 010 0000". */
  displayPhoneNumber?: string;
  /** Verified business name. */
  businessName?: string;
}

// --- Meta webhook payload shapes (defensively typed as partial/optional) ---

export interface MetaWebhookBody {
  object?: string;
  entry?: MetaEntry[];
}

export interface MetaEntry {
  id?: string; // WABA id
  changes?: MetaChange[];
}

export interface MetaChange {
  field?: string; // "messages"
  value?: MetaChangeValue;
}

export interface MetaChangeValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: MetaContact[];
  messages?: MetaMessage[];
  statuses?: MetaStatus[];
}

export interface MetaContact {
  wa_id?: string;
  profile?: { name?: string };
}

export interface MetaMessage {
  id?: string; // wamid
  from?: string; // sender wa_id (phone)
  timestamp?: string; // unix seconds (string)
  type?: string; // text | image | audio | video | document | location | contacts | sticker | reaction | button | interactive | unsupported
  text?: { body?: string };
  context?: { id?: string; from?: string }; // reply reference
  errors?: MetaError[];
}

export interface MetaStatus {
  id?: string; // wamid the status refers to
  status?: string; // sent | delivered | read | failed | deleted
  timestamp?: string;
  recipient_id?: string;
  errors?: MetaError[];
}

export interface MetaError {
  code?: number;
  title?: string;
  message?: string;
  error_data?: { details?: string };
}

/** Graph API error envelope. */
export interface MetaApiError {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}
