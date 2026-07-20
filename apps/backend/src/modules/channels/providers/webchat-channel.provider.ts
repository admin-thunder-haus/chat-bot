import { randomBytes, randomUUID } from 'node:crypto';
import type { ChannelType } from '@prisma/client';
import type {
  ChannelAccountInitResult,
  ChannelCapabilities,
  ChannelConnectionCheckInput,
  ChannelConnectionCheckResult,
  ChannelProvider,
  ChannelSendMessageInput,
  ChannelSendMessageResult,
  NormalizedChannelEvent,
  RawWebhookInput,
  WebhookSignatureInput,
  WebhookVerificationInput,
  WebhookVerificationResult,
} from './channel-provider.interface';
import { NO_CAPABILITIES } from './channel-provider.interface';
import { DEFAULT_WEBCHAT_CONFIG } from './webchat.config';

export const WEBCHAT_PROVIDER_KEY = 'webchat';

/** Shape of a normalized Web Chat inbound payload handed to `parseWebhook`. */
export interface WebChatInboundPayload {
  externalMessageId: string;
  externalConversationId?: string | null;
  visitorId: string;
  content: string;
  timestamp?: string;
  visitor?: {
    name?: string | null;
    email?: string | null;
  };
}

/**
 * The FIRST real channel provider and the reference implementation every future
 * provider follows. Web Chat's transport is a browser widget (see the `widget`
 * module) rather than a signed server webhook, so:
 *
 *  - `parseWebhook` normalizes the widget's inbound payload into the standard
 *    {@link NormalizedIncomingMessageEvent} — the ONLY provider-specific parsing.
 *  - `sendMessage` has no external API to call: an outbound message is persisted
 *    by the delivery engine and the widget polls it, so "send" just acknowledges
 *    with a synthetic external id (SENT). The visitor receives it on next poll.
 *  - `initializeAccount` mints a public widget key + default config on create.
 *  - Signature/challenge verification is handled by the widget session layer, so
 *    the webhook-engine hooks are inert for this provider.
 *
 * A future WhatsApp provider implements the SAME interface — only webhook
 * parsing, signature validation, the send API, status callbacks, and connection
 * validation differ. No business logic changes.
 */
export class WebChatChannelProvider implements ChannelProvider {
  readonly key = WEBCHAT_PROVIDER_KEY;
  readonly channelType: ChannelType = 'WEBCHAT';
  readonly developmentOnly = false;
  readonly requiresCredentials = false;
  readonly capabilities: ChannelCapabilities = {
    ...NO_CAPABILITIES,
    textMessages: true,
    messageReplies: true,
    deliveryReceipts: true,
    readReceipts: true,
    typingIndicators: true,
    customerProfiles: true,
    outboundMessaging: true,
    inboundMessaging: true,
  };

  initializeAccount(_input: { displayName: string }): ChannelAccountInitResult {
    return {
      // Public, non-secret widget key embedded on the customer's website.
      publicId: `wc_${randomBytes(18).toString('hex')}`,
      metadata: { webchat: { ...DEFAULT_WEBCHAT_CONFIG } },
      connectionState: 'HEALTHY',
    };
  }

  // --- Webhook-engine hooks (unused by the widget transport) ---------------

  async verifyWebhookChallenge(
    _input: WebhookVerificationInput,
  ): Promise<WebhookVerificationResult> {
    return { verified: false };
  }

  async validateWebhookSignature(
    _input: WebhookSignatureInput,
  ): Promise<boolean> {
    // Web Chat authenticates at the widget session layer, not via HMAC.
    return false;
  }

  /** Normalize a widget inbound payload. Raw provider payloads stop here. */
  async parseWebhook(input: RawWebhookInput): Promise<NormalizedChannelEvent[]> {
    const body = input.body as WebChatInboundPayload | null;
    if (
      !body ||
      typeof body !== 'object' ||
      !body.externalMessageId ||
      !body.visitorId ||
      !body.content
    ) {
      return [];
    }
    const timestamp = body.timestamp ? new Date(body.timestamp) : new Date();
    return [
      {
        kind: 'incoming_message',
        providerKey: this.key,
        channelType: this.channelType,
        externalEventId: body.externalMessageId,
        externalMessageId: body.externalMessageId,
        externalConversationId: body.externalConversationId ?? null,
        customer: {
          externalCustomerId: body.visitorId,
          fullName: body.visitor?.name ?? null,
          email: body.visitor?.email ?? null,
        },
        content: body.content,
        timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
      },
    ];
  }

  /**
   * No external API: the outbound message is already persisted; the widget polls
   * it. Acknowledge immediately with a synthetic external id.
   */
  async sendMessage(
    _input: ChannelSendMessageInput,
  ): Promise<ChannelSendMessageResult> {
    return {
      externalMessageId: `webchat-out-${randomUUID()}`,
      status: 'sent',
      providerMetadata: { transport: 'widget-poll' },
    };
  }

  async checkConnection(
    _input: ChannelConnectionCheckInput,
  ): Promise<ChannelConnectionCheckResult> {
    // The widget endpoint is always reachable when the account is enabled.
    return { state: 'HEALTHY' };
  }
}
