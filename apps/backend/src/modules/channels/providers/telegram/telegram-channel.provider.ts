import { timingSafeEqual } from 'node:crypto';
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
import { telegramApiClient } from './telegram-api-client';
import { normalizeTelegramWebhook } from './telegram-normalizer';
import type { TelegramConfig, TelegramCredentials } from './telegram.types';

export const TELEGRAM_PROVIDER_KEY = 'telegram';
export const TELEGRAM_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

function asCredentials(
  credentials: ProviderCredentials | null | undefined,
): TelegramCredentials | null {
  if (!credentials) return null;
  const { botToken, secretToken } = credentials as Record<string, unknown>;
  if (typeof botToken === 'string' && typeof secretToken === 'string') {
    return { botToken, secretToken };
  }
  return null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/**
 * Telegram Bot API provider — a non-Meta platform on the same generic Channel
 * Framework. Telegram-specific behavior (secret-token webhook auth, Update
 * parsing, Bot API sending, getMe health, setWebhook registration) is confined
 * here. One ChannelAccount == one bot (externalAccountId = numeric bot id).
 *
 * Webhook security is NOT an HMAC signature: Telegram echoes the secret token set
 * at registration in the X-Telegram-Bot-Api-Secret-Token header, which is what
 * validateWebhookSignature checks. There is no GET challenge. Inbound updates
 * already carry the sender's name/username, so no profile lookup is needed.
 */
export class TelegramChannelProvider implements ChannelProvider {
  readonly key = TELEGRAM_PROVIDER_KEY;
  readonly channelType: ChannelType = 'TELEGRAM';
  readonly developmentOnly = false;
  readonly requiresCredentials = true;
  readonly capabilities: ChannelCapabilities = {
    ...NO_CAPABILITIES,
    textMessages: true,
    messageReplies: true,
    customerProfiles: true,
    outboundMessaging: true,
    inboundMessaging: true,
    webhookSignatures: true, // secret-token header
    // Telegram gives no per-message delivery/read receipts to bots.
    deliveryReceipts: false,
    readReceipts: false,
    webhookVerification: false, // no GET challenge handshake
    // Outbound photos (public URL + caption) via the Bot API sendPhoto.
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
    const botToken = str(p.botToken);
    const secretToken = str(p.secretToken);

    const missing: { field: string; message: string }[] = [];
    if (!botToken || !/^\d+:[\w-]+$/.test(botToken)) {
      missing.push({ field: 'botToken', message: 'A valid bot token is required' });
    }
    if (!secretToken) {
      missing.push({ field: 'secretToken', message: 'Secret token is required' });
    }
    if (missing.length > 0) {
      throw AppError.badRequest('Validation failed', missing);
    }

    const botId = botToken!.split(':')[0];
    const config: TelegramConfig = {
      botId,
      botUsername: str(p.botUsername),
      botName: str(p.botName),
    };

    return {
      externalAccountId: botId,
      externalPageId: null,
      publicId: null,
      metadata: { telegram: config },
      secretCredentials: {
        botToken: botToken!,
        secretToken: secretToken!,
      } satisfies TelegramCredentials,
    };
  }

  // Telegram has no GET verification handshake — always unverified.
  async verifyWebhookChallenge(
    _input: WebhookVerificationInput,
  ): Promise<WebhookVerificationResult> {
    return { verified: false };
  }

  // Webhook auth = the secret token echoed in the header (constant-time compare).
  async validateWebhookSignature(input: WebhookSignatureInput): Promise<boolean> {
    const creds = asCredentials(input.credentials);
    if (!creds) return false;
    const provided = input.headers[TELEGRAM_SECRET_HEADER];
    if (typeof provided !== 'string' || provided.length === 0) return false;
    return safeEqual(provided, creds.secretToken);
  }

  async parseWebhook(input: RawWebhookInput): Promise<NormalizedChannelEvent[]> {
    try {
      return normalizeTelegramWebhook(input.body);
    } catch (err) {
      logger.warn('telegram.parse.error', {
        error: err instanceof Error ? err.message : 'unknown',
      });
      return [];
    }
  }

  async sendMessage(input: ChannelSendMessageInput): Promise<ChannelSendMessageResult> {
    const creds = asCredentials(input.credentials);
    const chatId = str(input.externalCustomerId);
    if (!creds) {
      return {
        externalMessageId: null,
        status: 'failed',
        retryable: false,
        failureCode: 'TG_NOT_CONFIGURED',
        failureReason: 'Telegram bot is not fully configured',
      };
    }
    if (!chatId) {
      return {
        externalMessageId: null,
        status: 'failed',
        retryable: false,
        failureCode: 'TG_NO_RECIPIENT',
        failureReason: 'Missing recipient chat',
      };
    }

    // Image messages use sendPhoto with the text as caption; text otherwise.
    const outcome = input.mediaUrl
      ? await telegramApiClient.sendPhoto({
          botToken: creds.botToken,
          chatId,
          photoUrl: input.mediaUrl,
          caption: input.text || null,
          replyToMessageId: input.replyToExternalMessageId ?? null,
        })
      : await telegramApiClient.sendText({
          botToken: creds.botToken,
          chatId,
          text: input.text,
          replyToMessageId: input.replyToExternalMessageId ?? null,
        });

    if (outcome.ok) {
      return {
        externalMessageId: outcome.externalMessageId ?? null,
        status: 'sent',
        providerMetadata: { provider: 'telegram' },
      };
    }
    return {
      externalMessageId: null,
      status: 'failed',
      retryable: outcome.retryable === true,
      failureCode: outcome.code ?? 'TG_SEND_FAILED',
      failureReason: outcome.reason ?? 'Telegram send failed',
    };
  }

  async checkConnection(
    input: ChannelConnectionCheckInput,
  ): Promise<ChannelConnectionCheckResult> {
    const creds = asCredentials(input.credentials);
    if (!creds) {
      return {
        state: 'UNAVAILABLE',
        errorCode: 'TG_NOT_CONFIGURED',
        errorMessage: 'Telegram bot is not fully configured',
      };
    }
    const outcome = await telegramApiClient.getMe({ botToken: creds.botToken });
    return {
      state: outcome.state,
      errorCode: outcome.state === 'HEALTHY' ? null : outcome.code ?? null,
      errorMessage: outcome.state === 'HEALTHY' ? null : outcome.reason ?? null,
    };
  }

  /**
   * Telegram-specific: register the bot's webhook so Telegram pushes updates to
   * our per-account URL (the Meta "subscribe" equivalent). Called by the connect
   * controller with the freshly-built URL. Never throws.
   */
  async registerWebhook(input: {
    botToken: string;
    url: string;
    secretToken: string;
  }): Promise<{ ok: boolean; reason?: string }> {
    return telegramApiClient.setWebhook(input);
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
