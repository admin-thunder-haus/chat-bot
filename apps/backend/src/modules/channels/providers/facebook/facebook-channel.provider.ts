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
import { facebookApiClient } from './facebook-api-client';
import { normalizeFacebookWebhook } from './facebook-normalizer';
import type { FacebookConfig, FacebookCredentials } from './facebook.types';

export const FACEBOOK_PROVIDER_KEY = 'facebook';
export const FACEBOOK_SIGNATURE_HEADER = 'x-hub-signature-256';

function asCredentials(
  credentials: ProviderCredentials | null | undefined,
): FacebookCredentials | null {
  if (!credentials) return null;
  const { accessToken, appSecret, verifyToken } = credentials as Record<string, unknown>;
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
 * Facebook Messenger (Meta) provider — the third real Meta platform, built on the
 * same generic Channel Framework. All Messenger-specific behavior (webhook
 * verification, HMAC signatures, Messenger payload parsing, Graph API sending,
 * health validation) is confined here. One ChannelAccount == one Facebook Page
 * (externalAccountId = Page id), with its own encrypted credentials.
 *
 * Messenger emits per-message delivery receipts (delivery.mids). Read receipts
 * are watermark-based (no message id) and recorded as unsupported. Media,
 * reactions, and templates are capability-flagged OFF (recorded, never crash).
 */
export class FacebookChannelProvider implements ChannelProvider {
  readonly key = FACEBOOK_PROVIDER_KEY;
  readonly channelType: ChannelType = 'FACEBOOK';
  readonly developmentOnly = false;
  readonly requiresCredentials = true;
  readonly capabilities: ChannelCapabilities = {
    ...NO_CAPABILITIES,
    textMessages: true,
    messageReplies: true,
    customerProfiles: true,
    deliveryReceipts: true,
    outboundMessaging: true,
    inboundMessaging: true,
    webhookVerification: true,
    webhookSignatures: true,
    // Messenger read receipts are watermark-based (not per-message) — not modeled.
    readReceipts: false,
    // Outbound images via a paired attachment message (no caption support).
    mediaMessages: true,
    templates: false,
    reactions: false,
    typingIndicators: false,
  };

  prepareConnection(input: {
    displayName: string;
    payload: Record<string, unknown>;
  }): ChannelConnectionPrepResult {
    const p = input.payload;
    const pageId = str(p.pageId);
    const accessToken = str(p.accessToken);
    const appSecret = str(p.appSecret);
    const verifyToken = str(p.verifyToken);

    const missing: { field: string; message: string }[] = [];
    if (!pageId) missing.push({ field: 'pageId', message: 'Facebook Page ID is required' });
    if (!accessToken) missing.push({ field: 'accessToken', message: 'Page access token is required' });
    if (!appSecret) missing.push({ field: 'appSecret', message: 'App secret is required' });
    if (!verifyToken) missing.push({ field: 'verifyToken', message: 'Verify token is required' });
    if (missing.length > 0) {
      throw AppError.badRequest('Validation failed', missing);
    }

    const config: FacebookConfig = {
      pageId: pageId!,
      pageName: str(p.pageName),
      businessName: str(p.businessName),
    };

    return {
      externalAccountId: pageId!,
      externalPageId: pageId!,
      publicId: null,
      metadata: { facebook: config },
      secretCredentials: {
        accessToken: accessToken!,
        appSecret: appSecret!,
        verifyToken: verifyToken!,
      } satisfies FacebookCredentials,
    };
  }

  async verifyWebhookChallenge(
    input: WebhookVerificationInput,
  ): Promise<WebhookVerificationResult> {
    const creds = asCredentials(input.credentials);
    const mode = input.query['hub.mode'];
    const token = input.query['hub.verify_token'];
    const challenge = input.query['hub.challenge'];
    if (!creds || mode !== 'subscribe' || !token) return { verified: false };
    if (!safeEqual(token, creds.verifyToken)) return { verified: false };
    return { verified: true, challenge: challenge ?? '' };
  }

  async validateWebhookSignature(input: WebhookSignatureInput): Promise<boolean> {
    const creds = asCredentials(input.credentials);
    if (!creds) return false;
    const header = input.headers[FACEBOOK_SIGNATURE_HEADER];
    if (!header || !header.startsWith('sha256=')) return false;
    const provided = header.slice('sha256='.length);
    const expected = createHmac('sha256', creds.appSecret).update(input.rawBody).digest('hex');
    return safeEqualHex(provided, expected);
  }

  static computeSignature(rawBody: Buffer | string, appSecret: string): string {
    return 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
  }

  async parseWebhook(input: RawWebhookInput): Promise<NormalizedChannelEvent[]> {
    try {
      return normalizeFacebookWebhook(input.body);
    } catch (err) {
      logger.warn('facebook.parse.error', {
        error: err instanceof Error ? err.message : 'unknown',
      });
      return [];
    }
  }

  async sendMessage(input: ChannelSendMessageInput): Promise<ChannelSendMessageResult> {
    const creds = asCredentials(input.credentials);
    const pageId = str(input.externalAccountId);
    const to = str(input.externalCustomerId);
    if (!creds || !pageId) {
      return {
        externalMessageId: null,
        status: 'failed',
        retryable: false,
        failureCode: 'FB_NOT_CONFIGURED',
        failureReason: 'Facebook Page is not fully configured',
      };
    }
    if (!to) {
      return {
        externalMessageId: null,
        status: 'failed',
        retryable: false,
        failureCode: 'FB_NO_RECIPIENT',
        failureReason: 'Missing recipient',
      };
    }

    const outcome = await facebookApiClient.sendText({
      accessToken: creds.accessToken,
      pageId,
      recipientId: to,
      text: input.text,
    });

    if (outcome.ok) {
      // Messenger attachments cannot carry captions, so the image goes out as
      // a best-effort second message. A failed image never fails the delivery
      // (the text already reached the customer — graceful degradation), and
      // retries can't duplicate the text because only text failures fail here.
      let imageDelivered: boolean | undefined;
      if (input.mediaUrl) {
        const img = await facebookApiClient.sendImage({
          accessToken: creds.accessToken,
          pageId,
          recipientId: to,
          imageUrl: input.mediaUrl,
        });
        imageDelivered = img.ok;
      }
      return {
        externalMessageId: outcome.externalMessageId ?? null,
        status: 'sent',
        providerMetadata: {
          provider: 'facebook',
          ...(imageDelivered !== undefined ? { imageDelivered } : {}),
        },
      };
    }
    return {
      externalMessageId: null,
      status: 'failed',
      retryable: outcome.retryable === true,
      failureCode: outcome.code ?? 'FB_SEND_FAILED',
      failureReason: outcome.reason ?? 'Facebook send failed',
    };
  }

  async fetchCustomerProfile(input: {
    externalCustomerId: string;
    credentials?: ProviderCredentials | null;
  }): Promise<{ fullName?: string | null } | null> {
    const creds = asCredentials(input.credentials);
    const psid = str(input.externalCustomerId);
    if (!creds || !psid) return null;
    return facebookApiClient.getProfile({ accessToken: creds.accessToken, psid });
  }

  async checkConnection(
    input: ChannelConnectionCheckInput,
  ): Promise<ChannelConnectionCheckResult> {
    const creds = asCredentials(input.credentials);
    const pageId = str(input.externalAccountId);
    if (!creds || !pageId) {
      return {
        state: 'UNAVAILABLE',
        errorCode: 'FB_NOT_CONFIGURED',
        errorMessage: 'Facebook Page is not fully configured',
      };
    }
    const outcome = await facebookApiClient.checkPage({
      accessToken: creds.accessToken,
      pageId,
    });
    return {
      state: outcome.state,
      errorCode: outcome.state === 'HEALTHY' ? null : outcome.code ?? null,
      errorMessage: outcome.state === 'HEALTHY' ? null : outcome.reason ?? null,
    };
  }
}

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
