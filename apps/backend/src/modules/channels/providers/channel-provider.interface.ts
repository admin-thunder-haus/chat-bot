import type { ChannelType } from '@prisma/client';

/**
 * Provider-agnostic channel abstraction. A future platform (WhatsApp,
 * Instagram, Telegram, …) only needs to implement {@link ChannelProvider};
 * nothing in the core Conversation/Message/Inbox/AI modules changes.
 *
 * Provider-specific raw payloads never leak past this boundary: providers
 * receive raw input and return strictly-typed, platform-independent
 * {@link NormalizedChannelEvent}s and results.
 */

/** Typed capability matrix. Absent/false means "not supported in Part 1". */
export interface ChannelCapabilities {
  textMessages: boolean;
  mediaMessages: boolean;
  /** Inbound voice notes (downloaded, stored, and transcribed when AI is on). */
  voiceMessages: boolean;
  messageReplies: boolean;
  deliveryReceipts: boolean;
  readReceipts: boolean;
  typingIndicators: boolean;
  reactions: boolean;
  templates: boolean;
  customerProfiles: boolean;
  webhookVerification: boolean;
  webhookSignatures: boolean;
  outboundMessaging: boolean;
  inboundMessaging: boolean;
}

/** Normalized customer profile carried by an incoming message event. */
export interface NormalizedCustomerProfile {
  externalCustomerId: string;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
}

/** Normalized inbound media reference (voice notes today). Providers emit
 *  either a direct CDN `url` (Meta) or a `providerMediaId` the provider later
 *  resolves itself (Telegram file_id, WhatsApp media id) — never both required. */
export interface NormalizedIncomingMedia {
  kind: 'audio';
  url?: string | null;
  providerMediaId?: string | null;
  mimeType?: string | null;
  durationSeconds?: number | null;
}

/** A normalized inbound text message (the only fully-processed event in Part 1). */
export interface NormalizedIncomingMessageEvent {
  kind: 'incoming_message';
  providerKey: string;
  channelType: ChannelType;
  externalEventId: string | null;
  externalMessageId: string;
  externalConversationId: string | null;
  customer: NormalizedCustomerProfile;
  content: string;
  timestamp: Date;
  replyToExternalMessageId?: string | null;
  /** Present for non-text inbound content (voice notes). `content` stays ''. */
  media?: NormalizedIncomingMedia;
  /** Safe, non-sensitive summary only (never raw payloads / credentials). */
  metadata?: Record<string, unknown>;
}

/** A normalized delivery-status update for a previously-sent message. */
export interface NormalizedDeliveryStatusEvent {
  kind: 'delivery_status';
  providerKey: string;
  externalEventId: string | null;
  externalMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: Date;
}

/** A normalized read receipt. */
export interface NormalizedReadReceiptEvent {
  kind: 'read_receipt';
  providerKey: string;
  externalEventId: string | null;
  externalMessageId: string;
  timestamp: Date;
}

/** Anything the provider recognized but the platform does not process yet. */
export interface NormalizedUnsupportedEvent {
  kind: 'unsupported';
  providerKey: string;
  externalEventId: string | null;
  eventType: string;
  timestamp: Date;
}

/** Discriminated union of every normalized event a provider may emit. */
export type NormalizedChannelEvent =
  | NormalizedIncomingMessageEvent
  | NormalizedDeliveryStatusEvent
  | NormalizedReadReceiptEvent
  | NormalizedUnsupportedEvent;

/**
 * Decrypted provider credentials passed to a provider at runtime. Resolved by
 * the framework (from the encrypted per-account ChannelCredential) and handed to
 * the provider ONLY when `requiresCredentials` is true. Providers must never log
 * or return these. Shape is provider-defined (e.g. WhatsApp: accessToken,
 * appSecret, verifyToken).
 */
export type ProviderCredentials = Record<string, unknown>;

/** Input to a GET webhook verification challenge (e.g. Meta hub.challenge). */
export interface WebhookVerificationInput {
  query: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  /** Decrypted per-account credentials (present only for credentialed providers). */
  credentials?: ProviderCredentials | null;
}

export interface WebhookVerificationResult {
  verified: boolean;
  /** Body to echo back on success (plain text), e.g. the challenge token. */
  challenge?: string;
}

/** Input to signature validation of a POST webhook. */
export interface WebhookSignatureInput {
  rawBody: Buffer;
  headers: Record<string, string | undefined>;
  credentials?: ProviderCredentials | null;
}

/** Raw, unverified webhook payload handed to the provider for parsing. */
export interface RawWebhookInput {
  channelType: ChannelType;
  body: unknown;
  headers: Record<string, string | undefined>;
  credentials?: ProviderCredentials | null;
}

/** Input to send an outbound message through the provider. */
export interface ChannelSendMessageInput {
  channelType: ChannelType;
  /** Provider-side account/page identifier, if known. */
  externalAccountId?: string | null;
  /** Provider-side recipient identifier (external customer id). */
  externalCustomerId?: string | null;
  externalConversationId?: string | null;
  replyToExternalMessageId?: string | null;
  text: string;
  /**
   * Optional publicly-reachable image URL. Only set when the provider's
   * `mediaMessages` capability is true (callers gate on it); the provider
   * then sends an image message with `text` as the caption.
   */
  mediaUrl?: string | null;
  /** 1-based attempt number (first send = 1, retries increment). */
  attemptNumber?: number;
  credentials?: ProviderCredentials | null;
}

export interface ChannelSendMessageResult {
  externalMessageId: string | null;
  status: 'sent' | 'delivered' | 'failed';
  /**
   * On failure, whether the error is transient. The delivery engine decides
   * retry eligibility from this: `false` (or omitted with a failed status) is
   * treated as a PERMANENT failure. Providers map their own error taxonomies.
   */
  retryable?: boolean;
  failureCode?: string;
  /** Safe, user-presentable failure summary — never provider internals. */
  failureReason?: string;
  /** Safe, non-sensitive provider metadata (never credentials). */
  providerMetadata?: Record<string, unknown>;
}

/** Input to an optional connection/health check. */
export interface ChannelConnectionCheckInput {
  externalAccountId?: string | null;
  metadata?: Record<string, unknown> | null;
  credentials?: ProviderCredentials | null;
}

export interface ChannelConnectionCheckResult {
  state: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'AUTH_EXPIRED';
  errorCode?: string | null;
  /** Safe, user-presentable summary — never leaks provider internals. */
  errorMessage?: string | null;
}

/** Result of a provider's optional account-initialization hook. */
export interface ChannelAccountInitResult {
  /** A public, non-secret identifier for browser-embeddable channels (Web Chat). */
  publicId?: string;
  /** Safe default account metadata (never credentials). Merged over client input. */
  metadata?: Record<string, unknown>;
  /** Optional initial connection state (e.g. Web Chat is HEALTHY once created). */
  connectionState?: ChannelConnectionCheckResult['state'];
}

/**
 * Result of a credentialed provider's connect hook. Splits the connect request
 * into the safe, storable account shape and the SECRET credentials the framework
 * will encrypt. Provider-specific validation lives entirely inside the hook.
 */
export interface ChannelConnectionPrepResult {
  externalAccountId: string | null;
  externalPageId: string | null;
  publicId?: string | null;
  /** Safe, non-sensitive account metadata (never secrets). */
  metadata?: Record<string, unknown>;
  connectionState?: ChannelConnectionCheckResult['state'];
  /** The secret credential object to encrypt + store (never persisted in plain). */
  secretCredentials: ProviderCredentials;
}

/**
 * The contract every channel provider implements. `checkConnection` and
 * `initializeAccount` are optional and must be feature/capability-gated by
 * callers. This is the reference shape real providers (Web Chat today; WhatsApp,
 * Messenger, Instagram, Telegram later) implement — nothing else changes.
 */
export interface ChannelProvider {
  readonly key: string;
  readonly channelType: ChannelType;
  readonly capabilities: ChannelCapabilities;
  /** Dev-only providers (e.g. the fake channel) are never exposed in prod. */
  readonly developmentOnly: boolean;
  /**
   * True when this provider stores encrypted per-account credentials (e.g.
   * WhatsApp: access token / app secret / verify token). The framework then
   * connects via {@link prepareConnection} and resolves + injects the decrypted
   * credentials into webhook/send/health calls. Credential-free providers (Web
   * Chat, fake) leave this false and are unaffected.
   */
  readonly requiresCredentials: boolean;

  /**
   * Optional one-time account setup, run when a channel account is created for
   * this provider. Web Chat uses it to mint a public widget key + default
   * widget config. Provider-specific — keeps account setup out of business logic.
   */
  initializeAccount?(input: {
    displayName: string;
  }): ChannelAccountInitResult;

  /**
   * Required for credentialed providers: validate a connect request and split it
   * into the safe account shape + secret credentials to encrypt. All
   * platform-specific connect validation lives here.
   */
  prepareConnection?(input: {
    displayName: string;
    payload: Record<string, unknown>;
  }): ChannelConnectionPrepResult;

  verifyWebhookChallenge(
    input: WebhookVerificationInput,
  ): Promise<WebhookVerificationResult>;

  validateWebhookSignature(input: WebhookSignatureInput): Promise<boolean>;

  parseWebhook(input: RawWebhookInput): Promise<NormalizedChannelEvent[]>;

  sendMessage(
    input: ChannelSendMessageInput,
  ): Promise<ChannelSendMessageResult>;

  checkConnection?(
    input: ChannelConnectionCheckInput,
  ): Promise<ChannelConnectionCheckResult>;

  /**
   * Optional best-effort lookup of an inbound sender's public profile (e.g.
   * Instagram username, Messenger name). Used to enrich a newly-created customer
   * so the Inbox shows a real name instead of "Unknown customer". Must be
   * timeout-protected and never throw — the inbound message matters more than
   * optional enrichment. Returns null when unavailable.
   */
  fetchCustomerProfile?(input: {
    externalCustomerId: string;
    credentials?: ProviderCredentials | null;
  }): Promise<Pick<
    NormalizedCustomerProfile,
    'fullName' | 'username' | 'avatarUrl'
  > | null>;

  /**
   * Optional best-effort download of an inbound media attachment (voice notes).
   * Provider-specific resolution (Telegram getFile, WhatsApp media lookup, Meta
   * CDN URLs) lives entirely inside the provider. Must be timeout-protected and
   * never throw — the inbound message matters more than its media. Returns null
   * when unavailable.
   */
  fetchInboundMedia?(input: {
    media: NormalizedIncomingMedia;
    credentials?: ProviderCredentials | null;
  }): Promise<{ buffer: Buffer; mimeType: string } | null>;
}

/** A capability matrix with every flag false — a safe base for spreading. */
export const NO_CAPABILITIES: ChannelCapabilities = {
  textMessages: false,
  mediaMessages: false,
  voiceMessages: false,
  messageReplies: false,
  deliveryReceipts: false,
  readReceipts: false,
  typingIndicators: false,
  reactions: false,
  templates: false,
  customerProfiles: false,
  webhookVerification: false,
  webhookSignatures: false,
  outboundMessaging: false,
  inboundMessaging: false,
};
