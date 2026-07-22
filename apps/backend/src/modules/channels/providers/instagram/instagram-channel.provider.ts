import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ChannelType } from '@prisma/client';
import { AppError } from '../../../../utils/AppError';
import { logger } from '../../../../utils/logger';
import type {
  ChannelCapabilities,
  ChannelConnectionCheckInput,
  ChannelConnectionCheckResult,
  ChannelConnectionPrepResult,
  ChannelProvider,
  ChannelSendMessageInput,
  ChannelSendMessageResult,
  NormalizedChannelEvent,
  ProviderCredentials,
  RawWebhookInput,
  WebhookSignatureInput,
  WebhookVerificationInput,
  WebhookVerificationResult,
} from '../channel-provider.interface';
import { NO_CAPABILITIES } from '../channel-provider.interface';
import { instagramApiClient } from './instagram-api-client';
import { normalizeInstagramWebhook } from './instagram-normalizer';
import type { InstagramConfig, InstagramCredentials } from './instagram.types';

export const INSTAGRAM_PROVIDER_KEY = 'instagram';
export const INSTAGRAM_SIGNATURE_HEADER = 'x-hub-signature-256';

/** Safely narrow decrypted credentials to the Instagram shape. */
function asCredentials(
  credentials: ProviderCredentials | null | undefined,
): InstagramCredentials | null {
  if (!credentials) return null;
  const { accessToken, appSecret, verifyToken } = credentials as Record<
    string,
    unknown
  >;
  if (
    typeof accessToken === 'string' &&
    typeof appSecret === 'string' &&
    typeof verifyToken === 'string'
  ) {
    return { accessToken, appSecret, verifyToken };
  }
  return null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/**
 * Instagram Messaging (Meta) provider — the second REAL Meta platform after
 * WhatsApp. It implements the standard {@link ChannelProvider} contract; ALL
 * Instagram-specific behavior (webhook verification, HMAC signatures, Messenger-
 * style payload parsing, Graph API sending, health validation) is confined here
 * and its support modules. Core Conversation/Message/Customer/Inbox/AI/Delivery
 * modules are untouched.
 *
 * Multi-tenant by construction: one ChannelAccount == one Instagram professional
 * account (externalAccountId = Instagram account id, externalPageId = Facebook
 * Page id), with its own encrypted credentials. Routing is by the stable
 * Instagram account id and the per-account webhook URL — never by @username.
 *
 * Media, reactions, story mentions, and templates are capability-flagged OFF:
 * their inbound events normalize to `unsupported` (recorded, never crash), and
 * adding them later is provider-only work — no business-logic change.
 */
export class InstagramChannelProvider implements ChannelProvider {
  readonly key = INSTAGRAM_PROVIDER_KEY;
  readonly channelType: ChannelType = 'INSTAGRAM';
  readonly developmentOnly = false;
  readonly requiresCredentials = true;
  readonly capabilities: ChannelCapabilities = {
    ...NO_CAPABILITIES,
    textMessages: true,
    messageReplies: true,
    customerProfiles: true,
    readReceipts: true,
    outboundMessaging: true,
    inboundMessaging: true,
    webhookVerification: true,
    webhookSignatures: true,
    // Instagram DMs do not emit delivery receipts for messages; only read.
    deliveryReceipts: false,
    // Architecture-ready but intentionally not implemented in Day 7:
    // Outbound images via a paired attachment message (no caption support).
    mediaMessages: true,
    templates: false,
    reactions: false,
    typingIndicators: false,
  };

  // --- Connect (credentialed) ---------------------------------------------

  prepareConnection(input: {
    displayName: string;
    payload: Record<string, unknown>;
  }): ChannelConnectionPrepResult {
    const p = input.payload;
    const instagramAccountId = str(p.instagramAccountId);
    const facebookPageId = str(p.facebookPageId);
    const accessToken = str(p.accessToken);
    const appSecret = str(p.appSecret);
    const verifyToken = str(p.verifyToken);

    const missing: { field: string; message: string }[] = [];
    if (!instagramAccountId)
      missing.push({
        field: 'instagramAccountId',
        message: 'Instagram account ID is required',
      });
    if (!accessToken)
      missing.push({ field: 'accessToken', message: 'Access token is required' });
    if (!appSecret)
      missing.push({ field: 'appSecret', message: 'App secret is required' });
    if (!verifyToken)
      missing.push({ field: 'verifyToken', message: 'Verify token is required' });
    if (missing.length > 0) {
      throw AppError.badRequest('Validation failed', missing);
    }

    const config: InstagramConfig = {
      instagramAccountId: instagramAccountId!,
      facebookPageId,
      instagramUsername: str(p.instagramUsername),
      businessName: str(p.businessName),
    };

    return {
      externalAccountId: instagramAccountId!,
      externalPageId: facebookPageId ?? null,
      publicId: null,
      metadata: { instagram: config },
      // Stays UNKNOWN until the connect flow's health check validates it
      // against the Graph API (honest connection state).
      secretCredentials: {
        accessToken: accessToken!,
        appSecret: appSecret!,
        verifyToken: verifyToken!,
      } satisfies InstagramCredentials,
    };
  }

  // --- Webhook verification (Meta subscription handshake) ------------------

  async verifyWebhookChallenge(
    input: WebhookVerificationInput,
  ): Promise<WebhookVerificationResult> {
    const creds = asCredentials(input.credentials);
    const mode = input.query['hub.mode'];
    const token = input.query['hub.verify_token'];
    const challenge = input.query['hub.challenge'];
    if (!creds || mode !== 'subscribe' || !token) {
      return { verified: false };
    }
    if (!safeEqual(token, creds.verifyToken)) {
      return { verified: false };
    }
    return { verified: true, challenge: challenge ?? '' };
  }

  // --- Webhook signature (X-Hub-Signature-256) ----------------------------

  async validateWebhookSignature(
    input: WebhookSignatureInput,
  ): Promise<boolean> {
    const creds = asCredentials(input.credentials);
    if (!creds) return false;
    const header = input.headers[INSTAGRAM_SIGNATURE_HEADER];
    if (!header || !header.startsWith('sha256=')) return false;
    const provided = header.slice('sha256='.length);
    const expected = createHmac('sha256', creds.appSecret)
      .update(input.rawBody)
      .digest('hex');
    return safeEqualHex(provided, expected);
  }

  /** Compute the signature Meta would send (test + docs helper). */
  static computeSignature(rawBody: Buffer | string, appSecret: string): string {
    return 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
  }

  // --- Webhook parsing (defensive; never throws on unknown fields) ---------

  async parseWebhook(input: RawWebhookInput): Promise<NormalizedChannelEvent[]> {
    try {
      return normalizeInstagramWebhook(input.body);
    } catch (err) {
      // A structurally surprising payload must never crash the webhook engine.
      logger.warn('instagram.parse.error', {
        error: err instanceof Error ? err.message : 'unknown',
      });
      return [];
    }
  }

  // --- Outbound send (Graph API) ------------------------------------------

  async sendMessage(
    input: ChannelSendMessageInput,
  ): Promise<ChannelSendMessageResult> {
    const creds = asCredentials(input.credentials);
    const instagramAccountId = str(input.externalAccountId);
    const to = str(input.externalCustomerId);
    if (!creds || !instagramAccountId) {
      return {
        externalMessageId: null,
        status: 'failed',
        retryable: false,
        failureCode: 'IG_NOT_CONFIGURED',
        failureReason: 'Instagram account is not fully configured',
      };
    }
    if (!to) {
      return {
        externalMessageId: null,
        status: 'failed',
        retryable: false,
        failureCode: 'IG_NO_RECIPIENT',
        failureReason: 'Missing recipient Instagram user',
      };
    }

    const outcome = await instagramApiClient.sendText({
      accessToken: creds.accessToken,
      instagramAccountId,
      recipientId: to,
      text: input.text,
    });

    if (outcome.ok) {
      // IG attachments cannot carry captions, so the image goes out as a
      // best-effort second message. A failed image never fails the delivery
      // (the text already reached the customer), and retries can't duplicate
      // the text because only text failures fail here.
      let imageDelivered: boolean | undefined;
      if (input.mediaUrl) {
        const img = await instagramApiClient.sendImage({
          accessToken: creds.accessToken,
          instagramAccountId,
          recipientId: to,
          imageUrl: input.mediaUrl,
        });
        imageDelivered = img.ok;
      }
      return {
        externalMessageId: outcome.externalMessageId ?? null,
        status: 'sent',
        providerMetadata: {
          provider: 'instagram',
          ...(imageDelivered !== undefined ? { imageDelivered } : {}),
        },
      };
    }
    return {
      externalMessageId: null,
      status: 'failed',
      retryable: outcome.retryable === true,
      failureCode: outcome.code ?? 'IG_SEND_FAILED',
      failureReason: outcome.reason ?? 'Instagram send failed',
    };
  }

  // --- Optional profile enrichment (Graph API) ----------------------------

  async fetchCustomerProfile(input: {
    externalCustomerId: string;
    credentials?: ProviderCredentials | null;
  }): Promise<{ fullName?: string | null; username?: string | null } | null> {
    const creds = asCredentials(input.credentials);
    const igsid = str(input.externalCustomerId);
    if (!creds || !igsid) return null;
    return instagramApiClient.getProfile({
      accessToken: creds.accessToken,
      igsid,
    });
  }

  // --- Connection health (Graph API) --------------------------------------

  async checkConnection(
    input: ChannelConnectionCheckInput,
  ): Promise<ChannelConnectionCheckResult> {
    const creds = asCredentials(input.credentials);
    const instagramAccountId = str(input.externalAccountId);
    if (!creds || !instagramAccountId) {
      return {
        state: 'UNAVAILABLE',
        errorCode: 'IG_NOT_CONFIGURED',
        errorMessage: 'Instagram account is not fully configured',
      };
    }
    const outcome = await instagramApiClient.checkAccount({
      accessToken: creds.accessToken,
      instagramAccountId,
    });
    return {
      state: outcome.state,
      errorCode: outcome.state === 'HEALTHY' ? null : outcome.code ?? null,
      errorMessage: outcome.state === 'HEALTHY' ? null : outcome.reason ?? null,
    };
  }
}

/** Constant-time string comparison (equal length required). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}
