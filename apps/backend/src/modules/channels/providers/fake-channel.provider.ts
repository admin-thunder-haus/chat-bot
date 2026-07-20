import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ChannelType } from '@prisma/client';
import { env } from '../../../config/env';
import { logger } from '../../../utils/logger';
import type {
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

export const FAKE_PROVIDER_KEY = 'fake';
export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';

/**
 * Markers in outbound text that drive the fake provider's send behavior (tests
 * + local dev). A real provider derives these outcomes from its API responses.
 */
export const FAKE_SEND_FAILURE_MARKER = '__FAIL__'; // permanent failure (no retry)
export const FAKE_SEND_TEMPORARY_MARKER = '__RETRY__'; // temporary failure (always)
export const FAKE_SEND_RECOVER_MARKER = '__RETRY_OK__'; // temp fail on attempt 1, then succeed

/**
 * Deterministic in-memory channel provider for development and automated tests.
 * It never calls any external service. It exercises the full framework:
 * webhook verification, HMAC signature validation, payload parsing +
 * normalization, outbound sending (with a deterministic failure switch), and
 * health checks (with a simulated-state switch driven by account metadata).
 *
 * The fake channel maps to the MANUAL {@link ChannelType}; it is distinguished
 * from truly-manual conversations by its channel account + provider key.
 */
export class FakeChannelProvider implements ChannelProvider {
  readonly key = FAKE_PROVIDER_KEY;
  readonly channelType: ChannelType = 'MANUAL';
  readonly developmentOnly = true;
  readonly requiresCredentials = false;
  readonly capabilities: ChannelCapabilities = {
    ...NO_CAPABILITIES,
    textMessages: true,
    messageReplies: true,
    deliveryReceipts: true,
    readReceipts: true,
    customerProfiles: true,
    webhookVerification: true,
    webhookSignatures: true,
    outboundMessaging: true,
    inboundMessaging: true,
  };

  private get webhookSecret(): string | undefined {
    return env.FAKE_CHANNEL_WEBHOOK_SECRET;
  }

  private get verifyToken(): string | undefined {
    return env.FAKE_CHANNEL_VERIFY_TOKEN;
  }

  async verifyWebhookChallenge(
    input: WebhookVerificationInput,
  ): Promise<WebhookVerificationResult> {
    const token = input.query.verify_token;
    const challenge = input.query.challenge;
    if (!this.verifyToken || !token || token !== this.verifyToken) {
      return { verified: false };
    }
    return { verified: true, challenge: challenge ?? '' };
  }

  async validateWebhookSignature(
    input: WebhookSignatureInput,
  ): Promise<boolean> {
    if (!this.webhookSecret) return false;
    const provided = input.headers[FAKE_SIGNATURE_HEADER];
    if (!provided) return false;
    const expected = createHmac('sha256', this.webhookSecret)
      .update(input.rawBody)
      .digest('hex');
    return safeEqualHex(provided, expected);
  }

  /** Compute the signature a caller must send (used by tests + docs). */
  static computeSignature(rawBody: Buffer | string, secret: string): string {
    return createHmac('sha256', secret).update(rawBody).digest('hex');
  }

  async parseWebhook(input: RawWebhookInput): Promise<NormalizedChannelEvent[]> {
    const body = input.body as FakeWebhookBody | null;
    if (!body || typeof body !== 'object') return [];

    const eventId = strOrNull(body.eventId);
    const timestamp = parseTimestamp(body.timestamp);

    switch (body.event) {
      case 'message': {
        if (!body.messageId || !body.customer?.id || !body.text) {
          return [
            {
              kind: 'unsupported',
              providerKey: this.key,
              externalEventId: eventId,
              eventType: 'message.malformed',
              timestamp,
            },
          ];
        }
        return [
          {
            kind: 'incoming_message',
            providerKey: this.key,
            channelType: this.channelType,
            externalEventId: eventId,
            externalMessageId: String(body.messageId),
            externalConversationId: strOrNull(body.conversationId),
            replyToExternalMessageId: strOrNull(body.replyToMessageId),
            customer: {
              externalCustomerId: String(body.customer.id),
              fullName: strOrNull(body.customer.name),
              firstName: strOrNull(body.customer.firstName),
              lastName: strOrNull(body.customer.lastName),
              phone: strOrNull(body.customer.phone),
              email: strOrNull(body.customer.email),
              username: strOrNull(body.customer.username),
            },
            content: String(body.text),
            timestamp,
          },
        ];
      }
      case 'delivery':
      case 'read': {
        if (!body.messageId) {
          return [];
        }
        if (body.event === 'read') {
          return [
            {
              kind: 'read_receipt',
              providerKey: this.key,
              externalEventId: eventId,
              externalMessageId: String(body.messageId),
              timestamp,
            },
          ];
        }
        return [
          {
            kind: 'delivery_status',
            providerKey: this.key,
            externalEventId: eventId,
            externalMessageId: String(body.messageId),
            status: normalizeDeliveryStatus(body.status),
            timestamp,
          },
        ];
      }
      default:
        return [
          {
            kind: 'unsupported',
            providerKey: this.key,
            externalEventId: eventId,
            eventType: `unknown:${String(body.event ?? 'none')}`,
            timestamp,
          },
        ];
    }
  }

  async sendMessage(
    input: ChannelSendMessageInput,
  ): Promise<ChannelSendMessageResult> {
    const attempt = input.attemptNumber ?? 1;

    // Permanent failure — never retried.
    if (input.text.includes(FAKE_SEND_FAILURE_MARKER)) {
      logger.warn('channel.fake.send.simulatedFailure', {
        externalAccountId: input.externalAccountId ?? null,
        kind: 'permanent',
      });
      return {
        externalMessageId: null,
        status: 'failed',
        retryable: false,
        failureCode: 'FAKE_PERMANENT',
        failureReason: 'Simulated permanent failure',
      };
    }
    // Temporary failure that recovers once retried (fails only on attempt 1).
    if (input.text.includes(FAKE_SEND_RECOVER_MARKER) && attempt < 2) {
      return {
        externalMessageId: null,
        status: 'failed',
        retryable: true,
        failureCode: 'FAKE_TEMPORARY',
        failureReason: 'Simulated transient failure (will recover)',
      };
    }
    // Temporary failure on every attempt (exhausts retries).
    if (input.text.includes(FAKE_SEND_TEMPORARY_MARKER)) {
      return {
        externalMessageId: null,
        status: 'failed',
        retryable: true,
        failureCode: 'FAKE_TEMPORARY',
        failureReason: 'Simulated transient failure',
      };
    }
    return {
      externalMessageId: `fake-out-${randomUUID()}`,
      status: 'sent',
      providerMetadata: { simulated: true, attempt },
    };
  }

  async checkConnection(
    input: ChannelConnectionCheckInput,
  ): Promise<ChannelConnectionCheckResult> {
    const simulate =
      (input.metadata?.healthSimulation as string | undefined) ?? 'healthy';
    switch (simulate) {
      case 'degraded':
        return {
          state: 'DEGRADED',
          errorCode: 'SIMULATED_DEGRADED',
          errorMessage: 'Simulated degraded connection',
        };
      case 'unavailable':
        return {
          state: 'UNAVAILABLE',
          errorCode: 'SIMULATED_UNAVAILABLE',
          errorMessage: 'Simulated unavailable connection',
        };
      case 'auth_expired':
        return {
          state: 'AUTH_EXPIRED',
          errorCode: 'SIMULATED_AUTH_EXPIRED',
          errorMessage: 'Simulated expired authentication',
        };
      default:
        return { state: 'HEALTHY' };
    }
  }
}

interface FakeWebhookBody {
  event?: string;
  eventId?: string;
  messageId?: string;
  conversationId?: string;
  replyToMessageId?: string;
  status?: string;
  text?: string;
  timestamp?: string;
  customer?: {
    id?: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    username?: string;
  };
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function parseTimestamp(v: unknown): Date {
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function normalizeDeliveryStatus(
  v: unknown,
): 'sent' | 'delivered' | 'read' | 'failed' {
  switch (v) {
    case 'delivered':
      return 'delivered';
    case 'read':
      return 'read';
    case 'failed':
      return 'failed';
    default:
      return 'sent';
  }
}

/** Constant-time comparison of two hex signature strings. */
function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}
