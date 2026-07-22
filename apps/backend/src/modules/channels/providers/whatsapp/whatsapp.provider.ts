import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ChannelType } from '@prisma/client';
import { env } from '../../../../config/env';
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
import { whatsAppApiClient } from './whatsapp-api.client';
import { mapWhatsAppStatus } from './whatsapp.status';
import type {
  MetaWebhookBody,
  WhatsAppConfig,
  WhatsAppCredentials,
} from './whatsapp.types';

export const WHATSAPP_PROVIDER_KEY = 'whatsapp';
export const WHATSAPP_SIGNATURE_HEADER = 'x-hub-signature-256';

/** Safely narrow decrypted credentials to the WhatsApp shape. */
function asCredentials(
  credentials: ProviderCredentials | null | undefined,
): WhatsAppCredentials | null {
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

function parseTimestamp(ts: unknown): Date {
  const n = typeof ts === 'string' ? Number(ts) : typeof ts === 'number' ? ts : NaN;
  if (Number.isFinite(n) && n > 0) {
    const d = new Date(n * 1000);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

/**
 * WhatsApp Business Cloud API (Meta) provider — the first REAL social platform.
 * It implements the standard {@link ChannelProvider} contract; ALL Meta-specific
 * behavior (webhook verification, HMAC signatures, payload parsing, Graph API
 * sending, status mapping, connect validation) is confined here. Core
 * Conversation/Message/Customer/Inbox/AI modules are untouched.
 *
 * Multi-tenant by construction: one ChannelAccount == one phone number
 * (externalAccountId = phone_number_id, externalPageId = WABA id), with its own
 * encrypted credentials. A company owns as many accounts (numbers) as it needs.
 *
 * Media, templates, reactions, and interactive messages are capability-flagged
 * OFF: their inbound events normalize to `unsupported` (recorded, never crash),
 * and adding them later is provider-only work — no business-logic change.
 */
export class WhatsAppChannelProvider implements ChannelProvider {
  readonly key = WHATSAPP_PROVIDER_KEY;
  readonly channelType: ChannelType = 'WHATSAPP';
  readonly developmentOnly = false;
  readonly requiresCredentials = true;
  readonly capabilities: ChannelCapabilities = {
    ...NO_CAPABILITIES,
    textMessages: true,
    messageReplies: true,
    deliveryReceipts: true,
    readReceipts: true,
    customerProfiles: true,
    outboundMessaging: true,
    inboundMessaging: true,
    webhookVerification: true,
    webhookSignatures: true,
    // Outbound image messages (public URL + caption) via the Graph API.
    mediaMessages: true,
    // Architecture-ready but intentionally not yet implemented (Day 6 scope):
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
    const phoneNumberId = str(p.phoneNumberId);
    const wabaId = str(p.wabaId);
    const accessToken = str(p.accessToken);
    const appSecret = str(p.appSecret);
    const verifyToken = str(p.verifyToken);

    const missing: { field: string; message: string }[] = [];
    if (!phoneNumberId) missing.push({ field: 'phoneNumberId', message: 'Phone Number ID is required' });
    if (!wabaId) missing.push({ field: 'wabaId', message: 'Business Account (WABA) ID is required' });
    if (!accessToken) missing.push({ field: 'accessToken', message: 'Access token is required' });
    if (!appSecret) missing.push({ field: 'appSecret', message: 'App secret is required' });
    if (!verifyToken) missing.push({ field: 'verifyToken', message: 'Verify token is required' });
    if (missing.length > 0) {
      throw AppError.badRequest('Validation failed', missing);
    }

    const config: WhatsAppConfig = {
      phoneNumberId: phoneNumberId!,
      wabaId: wabaId!,
      displayPhoneNumber: str(p.displayPhoneNumber),
      businessName: str(p.businessName),
    };

    return {
      externalAccountId: phoneNumberId!,
      externalPageId: wabaId!,
      publicId: null,
      metadata: { whatsapp: config },
      // Connection state stays UNKNOWN (the service default) until a health check
      // confirms it against the Graph API.
      secretCredentials: {
        accessToken: accessToken!,
        appSecret: appSecret!,
        verifyToken: verifyToken!,
      } satisfies WhatsAppCredentials,
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
    const header = input.headers[WHATSAPP_SIGNATURE_HEADER];
    if (!header || !header.startsWith('sha256=')) return false;
    const provided = header.slice('sha256='.length);
    const expected = createHmac('sha256', creds.appSecret)
      .update(input.rawBody)
      .digest('hex');
    return safeEqualHex(provided, expected);
  }

  /** Compute the signature Meta would send (test + docs helper). */
  static computeSignature(rawBody: Buffer | string, appSecret: string): string {
    return (
      'sha256=' +
      createHmac('sha256', appSecret).update(rawBody).digest('hex')
    );
  }

  // --- Webhook parsing (defensive; never throws on unknown fields) ---------

  async parseWebhook(input: RawWebhookInput): Promise<NormalizedChannelEvent[]> {
    try {
      return this.parse(input.body);
    } catch (err) {
      // A structurally surprising payload must never crash the webhook engine.
      logger.warn('whatsapp.parse.error', {
        error: err instanceof Error ? err.message : 'unknown',
      });
      return [];
    }
  }

  private parse(rawBody: unknown): NormalizedChannelEvent[] {
    const body = (rawBody ?? {}) as MetaWebhookBody;
    // Only WhatsApp Business Account events; anything else is ignored safely.
    if (body.object && body.object !== 'whatsapp_business_account') return [];

    const events: NormalizedChannelEvent[] = [];
    for (const entry of body.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        if (change?.field && change.field !== 'messages') continue;
        const value = change?.value;
        if (!value) continue;

        const nameByWaId = new Map<string, string>();
        for (const c of value.contacts ?? []) {
          if (c?.wa_id && c.profile?.name) nameByWaId.set(c.wa_id, c.profile.name);
        }

        // Inbound messages.
        for (const msg of value.messages ?? []) {
          const id = str(msg?.id);
          const from = str(msg?.from);
          if (!id || !from) continue;
          const type = str(msg?.type) ?? 'unknown';
          const timestamp = parseTimestamp(msg?.timestamp);
          if (type === 'text' && str(msg?.text?.body)) {
            events.push({
              kind: 'incoming_message',
              providerKey: this.key,
              channelType: this.channelType,
              externalEventId: id,
              externalMessageId: id,
              externalConversationId: null,
              customer: {
                externalCustomerId: from,
                fullName: nameByWaId.get(from) ?? null,
                phone: from,
              },
              content: msg!.text!.body!,
              timestamp,
              replyToExternalMessageId: str(msg?.context?.id) ?? null,
              metadata: {
                phoneNumberId: str(value.metadata?.phone_number_id),
                messageType: type,
              },
            });
          } else {
            // Media / location / contacts / interactive / reaction / etc.
            // Architecture-ready: recorded as unsupported, never processed yet.
            events.push({
              kind: 'unsupported',
              providerKey: this.key,
              externalEventId: id,
              eventType: `message.${type}`,
              timestamp,
            });
          }
        }

        // Status callbacks (delivery / read / failed).
        for (const st of value.statuses ?? []) {
          const id = str(st?.id);
          if (!id) continue;
          const mapped = mapWhatsAppStatus(st?.status);
          const timestamp = parseTimestamp(st?.timestamp);
          if (!mapped) {
            events.push({
              kind: 'unsupported',
              providerKey: this.key,
              externalEventId: `${id}:${str(st?.status) ?? 'unknown'}`,
              eventType: `status.${str(st?.status) ?? 'unknown'}`,
              timestamp,
            });
            continue;
          }
          if (mapped === 'read') {
            events.push({
              kind: 'read_receipt',
              providerKey: this.key,
              externalEventId: `${id}:read`,
              externalMessageId: id,
              timestamp,
            });
          } else {
            events.push({
              kind: 'delivery_status',
              providerKey: this.key,
              externalEventId: `${id}:${mapped}`,
              externalMessageId: id,
              status: mapped,
              timestamp,
            });
          }
        }
      }
    }
    return events;
  }

  // --- Outbound send (Graph API) ------------------------------------------

  async sendMessage(
    input: ChannelSendMessageInput,
  ): Promise<ChannelSendMessageResult> {
    const creds = asCredentials(input.credentials);
    const phoneNumberId = str(input.externalAccountId);
    const to = str(input.externalCustomerId);
    if (!creds || !phoneNumberId) {
      return {
        externalMessageId: null,
        status: 'failed',
        retryable: false,
        failureCode: 'WA_NOT_CONFIGURED',
        failureReason: 'WhatsApp account is not fully configured',
      };
    }
    if (!to) {
      return {
        externalMessageId: null,
        status: 'failed',
        retryable: false,
        failureCode: 'WA_NO_RECIPIENT',
        failureReason: 'Missing recipient phone number',
      };
    }

    // Image messages carry the text as the caption; text-only otherwise.
    const outcome = input.mediaUrl
      ? await whatsAppApiClient.sendImage({
          accessToken: creds.accessToken,
          phoneNumberId,
          to,
          imageUrl: input.mediaUrl,
          caption: input.text || null,
          replyToMessageId: input.replyToExternalMessageId ?? null,
        })
      : await whatsAppApiClient.sendText({
          accessToken: creds.accessToken,
          phoneNumberId,
          to,
          text: input.text,
          replyToMessageId: input.replyToExternalMessageId ?? null,
        });

    if (outcome.ok) {
      return {
        externalMessageId: outcome.externalMessageId ?? null,
        status: 'sent',
        providerMetadata: { provider: 'whatsapp', apiVersion: env.WHATSAPP_API_VERSION },
      };
    }
    return {
      externalMessageId: null,
      status: 'failed',
      retryable: outcome.retryable === true,
      failureCode: outcome.code ?? 'WA_SEND_FAILED',
      failureReason: outcome.reason ?? 'WhatsApp send failed',
    };
  }

  // --- Connection health (Graph API) --------------------------------------

  async checkConnection(
    input: ChannelConnectionCheckInput,
  ): Promise<ChannelConnectionCheckResult> {
    const creds = asCredentials(input.credentials);
    const phoneNumberId = str(input.externalAccountId);
    if (!creds || !phoneNumberId) {
      return {
        state: 'UNAVAILABLE',
        errorCode: 'WA_NOT_CONFIGURED',
        errorMessage: 'WhatsApp account is not fully configured',
      };
    }
    const outcome = await whatsAppApiClient.checkPhoneNumber({
      accessToken: creds.accessToken,
      phoneNumberId,
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
