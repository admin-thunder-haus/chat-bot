import type {
  ChannelCapabilities,
  ChannelProvider,
  ChannelSendMessageInput,
  ChannelSendMessageResult,
  NormalizedChannelEvent,
  RawWebhookInput,
  WebhookSignatureInput,
  WebhookVerificationInput,
  WebhookVerificationResult,
} from './channel-provider.interface';
import type { ChannelType } from '@prisma/client';

/**
 * Convenience base class for provider adapters. Provides safe defaults that a
 * concrete provider overrides only for the capabilities it actually supports.
 * By default nothing is verified/parsed/sent, which keeps unimplemented future
 * providers inert rather than accidentally functional.
 */
export abstract class BaseChannelProvider implements ChannelProvider {
  abstract readonly key: string;
  abstract readonly channelType: ChannelType;
  abstract readonly capabilities: ChannelCapabilities;
  readonly developmentOnly: boolean = false;
  readonly requiresCredentials: boolean = false;

  async verifyWebhookChallenge(
    _input: WebhookVerificationInput,
  ): Promise<WebhookVerificationResult> {
    return { verified: false };
  }

  async validateWebhookSignature(
    _input: WebhookSignatureInput,
  ): Promise<boolean> {
    // Fail closed: a provider without signature support rejects all payloads.
    return false;
  }

  async parseWebhook(_input: RawWebhookInput): Promise<NormalizedChannelEvent[]> {
    return [];
  }

  async sendMessage(
    _input: ChannelSendMessageInput,
  ): Promise<ChannelSendMessageResult> {
    return { externalMessageId: null, status: 'failed' };
  }

  // `checkConnection` is intentionally not implemented here: it is optional on
  // the interface, and concrete providers declare their own when supported.
}
