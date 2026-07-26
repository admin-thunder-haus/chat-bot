import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { ChannelAccount } from '@prisma/client';
import { prisma } from '../../../config/prisma';
import { AppError } from '../../../utils/AppError';
import { logger } from '../../../utils/logger';
import { imagesRepository } from '../../images/images.repository';
import { publicImageUrl } from '../../images/images.service';
import { aiTranscriptionService } from '../../ai/ai-transcription.service';
import { channelRegistry } from '../channel-registry';
import { channelsRepository } from '../channels.repository';
import { channelNormalizerService } from '../channel-normalizer.service';
import { channelPipelineService } from '../channel-pipeline.service';
import { channelDeliveryService } from '../channel-delivery.service';
import { channelCredentialsService } from '../channel-credentials.service';
import type {
  ChannelProvider,
  NormalizedChannelEvent,
  NormalizedDeliveryStatusEvent,
  NormalizedIncomingMedia,
  NormalizedIncomingMessageEvent,
  NormalizedReadReceiptEvent,
  ProviderCredentials,
} from '../providers/channel-provider.interface';
// Imported from the service, not the module index: the index pulls the handler
// registry, which imports this file back.
import { jobsService } from '../../jobs/jobs.service';
import { PermanentJobError } from '../../jobs/jobs.types';
import { isUuid } from './webhook.validation';
import type {
  WebhookProcessingResult,
  WebhookVerificationOutcome,
} from './webhook.types';

function hashRaw(rawBody: Buffer): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

/**
 * Generic webhook engine. Provider-agnostic: it resolves the provider, verifies
 * challenge/signature (BEFORE trusting the payload), resolves the channel
 * account (deriving the tenant securely — never from client input), records the
 * event, and drives the shared pipeline. It intentionally does not reveal
 * whether arbitrary account ids exist.
 */
export const webhookService = {
  /**
   * GET verification challenge (e.g. Meta hub.challenge). For credentialed
   * providers the per-account verify token is resolved from the account's
   * encrypted credentials; credential-free providers verify against env config.
   */
  async verify(
    providerKey: string,
    channelAccountId: string,
    query: Record<string, string | undefined>,
    headers: Record<string, string | undefined>,
  ): Promise<WebhookVerificationOutcome> {
    const provider = channelRegistry.tryGet(providerKey);
    if (!provider) throw AppError.notFound('Not found');

    let credentials: ProviderCredentials | null = null;
    if (provider.requiresCredentials) {
      if (!isUuid(channelAccountId)) throw AppError.forbidden('Verification failed');
      const account = await channelsRepository.findForWebhook(
        channelAccountId,
        providerKey,
      );
      if (!account) throw AppError.forbidden('Verification failed');
      credentials = await channelCredentialsService.load(
        account.companyId,
        account.id,
      );
    }

    const result = await provider.verifyWebhookChallenge({
      query,
      headers,
      credentials,
    });
    if (!result.verified) {
      // Generic 403 — never reveals why verification failed.
      throw AppError.forbidden('Verification failed');
    }
    return { verified: true, challenge: result.challenge ?? '' };
  },

  /**
   * POST event ingest. The signature is ALWAYS validated before the payload is
   * trusted. Credential-free providers use a global secret (signature-first,
   * then account resolution). Credentialed providers (WhatsApp) need a
   * per-account secret, so the account + decrypted credentials are resolved
   * first; an unknown account or bad signature both return a generic 401 (no
   * account-existence leak).
   */
  async handleIncoming(params: {
    providerKey: string;
    channelAccountId: string;
    rawBody: Buffer;
    body: unknown;
    headers: Record<string, string | undefined>;
    /** Absolute origin of this API (for building public media URLs). */
    publicBaseUrl?: string;
  }): Promise<WebhookProcessingResult> {
    const { providerKey, channelAccountId, rawBody, body, headers } = params;
    const publicBaseUrl = params.publicBaseUrl ?? '';

    const provider = channelRegistry.tryGet(providerKey);
    if (!provider) throw AppError.notFound('Not found');

    const empty: WebhookProcessingResult = {
      acknowledged: true,
      processed: 0,
      duplicates: 0,
      ignored: 0,
      failed: 0,
    };

    if (provider.requiresCredentials) {
      // Resolve account first (per-account app secret is required to verify).
      if (!isUuid(channelAccountId)) throw AppError.unauthorized('Invalid signature');
      const account = await channelsRepository.findForWebhook(
        channelAccountId,
        providerKey,
      );
      if (!account || !account.isEnabled) {
        throw AppError.unauthorized('Invalid signature');
      }
      const credentials = await channelCredentialsService.load(
        account.companyId,
        account.id,
      );
      const signatureOk = await provider.validateWebhookSignature({
        rawBody,
        headers,
        credentials,
      });
      if (!signatureOk) {
        // Record the rejected delivery (for a KNOWN account) with SAFE diagnostic
        // metadata (no secrets, no signature values) so a credential mismatch vs
        // a raw-body/header problem is distinguishable. Never throws.
        try {
          const h256 = headers['x-hub-signature-256'];
          const h1 = headers['x-hub-signature'];
          const providedHexLen =
            typeof h256 === 'string' && h256.startsWith('sha256=')
              ? h256.length - 'sha256='.length
              : 0;
          const diag = `sigrej:h256=${h256 ? 1 : 0},h1=${h1 ? 1 : 0},raw=${rawBody.length},plen=${providedHexLen},ct=${(headers['content-type'] ?? '').split(';')[0]}`;
          await channelsRepository.createWebhookEvent({
            companyId: account.companyId,
            channelAccountId: account.id,
            providerKey,
            eventType: diag,
            externalEventId: `sigrej:${Date.now()}:${hashRaw(rawBody).slice(0, 12)}`,
            status: 'FAILED',
            rawPayloadHash: hashRaw(rawBody),
          });
        } catch {
          /* diagnostic only — ignore */
        }
        throw AppError.unauthorized('Invalid signature');
      }
      return this.ingest(provider, account, providerKey, rawBody, body, headers, credentials, publicBaseUrl);
    }

    // --- Credential-free providers (existing behavior, unchanged) ---
    const signatureOk = await provider.validateWebhookSignature({ rawBody, headers });
    if (!signatureOk) throw AppError.unauthorized('Invalid signature');

    if (!isUuid(channelAccountId)) return empty;
    const account = await channelsRepository.findForWebhook(
      channelAccountId,
      providerKey,
    );
    if (!account || !account.isEnabled) return empty;

    return this.ingest(provider, account, providerKey, rawBody, body, headers, null, publicBaseUrl);
  },

  /** Parse (provider-specific) + process each normalized event. */
  async ingest(
    provider: ChannelProvider,
    account: ChannelAccount,
    providerKey: string,
    rawBody: Buffer,
    body: unknown,
    headers: Record<string, string | undefined>,
    credentials: ProviderCredentials | null,
    publicBaseUrl = '',
  ): Promise<WebhookProcessingResult> {
    const rawHash = hashRaw(rawBody);
    let events: NormalizedChannelEvent[];
    try {
      events = await provider.parseWebhook({
        channelType: account.channelType,
        body,
        headers,
        credentials,
      });
    } catch (err) {
      logger.warn('webhook.parse.error', {
        providerKey,
        channelAccountId: account.id,
        error: err instanceof Error ? err.message : 'unknown',
      });
      events = [];
    }

    const result: WebhookProcessingResult = {
      acknowledged: true,
      processed: 0,
      duplicates: 0,
      ignored: 0,
      failed: 0,
    };

    for (const event of events) {
      // eslint-disable-next-line no-await-in-loop
      await this.processEvent(
        account,
        providerKey,
        rawHash,
        event,
        result,
        provider,
        credentials,
        publicBaseUrl,
      );
    }

    return result;
  },

  /** Process one normalized event, recording a durable, idempotent audit row. */
  async processEvent(
    account: ChannelAccount,
    providerKey: string,
    rawHash: string,
    event: NormalizedChannelEvent,
    result: WebhookProcessingResult,
    provider: ChannelProvider,
    credentials: ProviderCredentials | null,
    publicBaseUrl = '',
  ): Promise<void> {
    const companyId = account.companyId;
    const externalEventId = event.externalEventId ?? null;
    const eventType = event.kind;

    // Idempotency: skip an already-recorded event for this account.
    if (externalEventId) {
      const existing = await channelsRepository.findWebhookEvent(
        account.id,
        providerKey,
        externalEventId,
      );
      if (existing) {
        result.duplicates += 1;
        await prisma.$transaction(async (tx) => {
          await channelsRepository.logChannelActivity(tx, {
            companyId,
            channelAccountId: account.id,
            activityType: 'WEBHOOK_DUPLICATE',
            metadata: { externalEventId, eventType },
          });
        });
        return;
      }
    }

    // Record the received event. A race on the unique key falls back to
    // duplicate handling instead of throwing.
    let eventRowId: string;
    try {
      const row = await channelsRepository.createWebhookEvent({
        companyId,
        channelAccountId: account.id,
        providerKey,
        eventType,
        externalEventId,
        status: 'RECEIVED',
        rawPayloadHash: rawHash,
      });
      eventRowId = row.id;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        result.duplicates += 1;
        return;
      }
      throw err;
    }

    try {
      switch (event.kind) {
        case 'incoming_message':
          await this.processIncomingMessage(
            account,
            event,
            eventRowId,
            result,
            provider,
            credentials,
            publicBaseUrl,
          );
          break;
        case 'delivery_status':
          await this.processDeliveryStatus(account, event, eventRowId, result);
          break;
        case 'read_receipt':
          await this.processReadReceipt(account, event, eventRowId, result);
          break;
        default:
          await channelsRepository.updateWebhookEvent(eventRowId, {
            status: 'IGNORED',
            processedAt: new Date(),
            normalizedPayload: { kind: event.kind } as Prisma.InputJsonValue,
          });
          result.ignored += 1;
      }
    } catch (err) {
      // Fail this one event safely — never corrupt existing records.
      result.failed += 1;
      await channelsRepository.updateWebhookEvent(eventRowId, {
        status: 'FAILED',
        failedAt: new Date(),
        failureCode: 'PROCESSING_ERROR',
        failureMessage:
          err instanceof AppError ? err.message : 'Failed to process event',
      });
      logger.warn('webhook.process.error', {
        companyId,
        channelAccountId: account.id,
        eventType,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  },

  async processIncomingMessage(
    account: ChannelAccount,
    event: NormalizedIncomingMessageEvent,
    eventRowId: string,
    result: WebhookProcessingResult,
    provider: ChannelProvider,
    credentials: ProviderCredentials | null,
    publicBaseUrl = '',
  ): Promise<void> {
    const companyId = account.companyId;
    const normalized = channelNormalizerService.normalizeIncoming(event);
    const isAudio = event.media?.kind === 'audio';

    // Best-effort profile enrichment so the Inbox shows a real name instead of
    // "Unknown customer". Only when the event carries no name AND the customer is
    // new / unnamed (avoids an API call per message). Never blocks or throws.
    if (
      typeof provider.fetchCustomerProfile === 'function' &&
      !normalized.customer.fullName &&
      !normalized.customer.username
    ) {
      const existing = await prisma.customer.findFirst({
        where: {
          companyId,
          channelType: account.channelType,
          externalId: normalized.externalCustomerId,
        },
        select: { fullName: true, username: true },
      });
      if (!existing || (!existing.fullName && !existing.username)) {
        const profile = await provider
          .fetchCustomerProfile({
            externalCustomerId: normalized.externalCustomerId,
            // Some platforms only expose the sender's name through an
            // account-scoped node (e.g. the Facebook Page's conversation list).
            externalAccountId: account.externalAccountId,
            credentials,
          })
          .catch((err: unknown) => {
            // Never fatal, but never silent either: a swallowed error here is
            // exactly why "Unknown customer" was undiagnosable in production.
            logger.warn('channel.profile.fetchFailed', {
              companyId,
              channelAccountId: account.id,
              providerKey: account.providerKey,
              error: err instanceof Error ? err.message : 'unknown',
            });
            return null;
          });
        if (profile?.fullName) normalized.customer.fullName = profile.fullName;
        if (profile?.username) normalized.customer.username = profile.username;
        if (!profile?.fullName && !profile?.username) {
          logger.warn('channel.profile.fetchFailed', {
            companyId,
            channelAccountId: account.id,
            providerKey: account.providerKey,
            reason: 'no_name_resolved',
          });
        }
      }
    }

    const ingest = await channelPipelineService.ingestInbound({
      companyId,
      channelType: account.channelType,
      channelAccountId: account.id,
      providerKey: account.providerKey,
      actorUserId: null,
      source: `webhook:${account.providerKey}`,
      message: normalized,
    });

    // Safe summary only — never the raw payload or full message content.
    const summary = {
      kind: 'incoming_message',
      externalMessageId: normalized.externalMessageId,
      contentLength: normalized.content.length,
      duplicate: ingest.idempotent,
    };

    await prisma.$transaction(async (tx) => {
      await channelsRepository.logChannelActivity(tx, {
        companyId,
        channelAccountId: account.id,
        conversationId: ingest.conversationId || null,
        activityType: ingest.idempotent ? 'WEBHOOK_DUPLICATE' : 'WEBHOOK_RECEIVED',
        metadata: { messageId: ingest.messageId, source: 'webhook' },
      });
    });

    await channelsRepository.updateWebhookEvent(eventRowId, {
      status: ingest.idempotent ? 'DUPLICATE' : 'PROCESSED',
      processedAt: new Date(),
      normalizedPayload: summary as Prisma.InputJsonValue,
    });

    if (ingest.idempotent) {
      result.duplicates += 1;
      return;
    }
    result.processed += 1;

    // Everything past this point is BACKGROUND work. The webhook returns as
    // soon as the message is durably stored: a media download and a Whisper
    // call on the request path is exactly the latency that makes Meta mark an
    // endpoint as failing, and a burst of inbound messages would otherwise
    // queue behind each other's OpenAI calls.
    if (isAudio && event.media) {
      // The audio job transcribes AND then enqueues the auto-reply itself, so
      // the AI only ever sees a message whose transcript is already stored.
      await jobsService.enqueueSafely('channel.inbound-audio', companyId, {
        messageId: ingest.messageId,
        channelAccountId: account.id,
        providerKey: account.providerKey,
        externalMessageId: normalized.externalMessageId,
        media: event.media,
        publicBaseUrl,
      });
      return;
    }

    await jobsService.enqueueSafely('ai.auto-reply', companyId, {
      messageId: ingest.messageId,
    });
  },

  /**
   * Queue entry point for an inbound voice note. Re-resolves the provider and
   * its credentials from ids — a job row must never carry credentials, and by
   * the time it runs the account may have been reconnected with new ones.
   *
   * Then enqueues the auto-reply, but ONLY when a transcript exists: without
   * one the AI has nothing to answer, exactly as the inline version required.
   */
  async processInboundAudioJob(params: {
    companyId: string;
    messageId: string;
    channelAccountId: string;
    providerKey: string;
    externalMessageId: string;
    media: NormalizedIncomingMedia;
    publicBaseUrl: string;
  }): Promise<void> {
    const provider = channelRegistry.tryGet(params.providerKey);
    if (!provider) {
      throw new PermanentJobError(
        `Provider "${params.providerKey}" is no longer registered`,
      );
    }
    const account = await channelsRepository.findForWebhook(
      params.channelAccountId,
      params.providerKey,
    );
    if (!account || account.companyId !== params.companyId) {
      // Disconnected or deleted between webhook and job: the AUDIO message is
      // already stored, and no retry can bring the account back.
      throw new PermanentJobError(
        'The channel account no longer exists for this company',
      );
    }
    const credentials = provider.requiresCredentials
      ? await channelCredentialsService.load(account.companyId, account.id)
      : null;

    const transcript = await this.processInboundAudio({
      companyId: params.companyId,
      messageId: params.messageId,
      media: params.media,
      externalMessageId: params.externalMessageId,
      provider,
      credentials,
      publicBaseUrl: params.publicBaseUrl,
    });

    if (transcript && transcript.trim() !== '') {
      await jobsService.enqueueSafely('ai.auto-reply', params.companyId, {
        messageId: params.messageId,
      });
    }
  },

  /**
   * Post-ingest processing for an inbound voice note: download the bytes via
   * the provider, store them (served on the public media URL), then transcribe
   * and fill the message content. Best-effort by design — any failure leaves
   * the AUDIO message intact and NEVER fails the webhook (providers would
   * retry the whole delivery otherwise). Returns the transcript text, if any.
   */
  async processInboundAudio(params: {
    companyId: string;
    messageId: string;
    /** Provider pointer to the audio (CDN url or provider media id). */
    media: NormalizedIncomingMedia;
    externalMessageId: string;
    provider: ChannelProvider;
    credentials: ProviderCredentials | null;
    publicBaseUrl: string;
  }): Promise<string | null> {
    const { companyId, messageId, media, provider, credentials } = params;
    try {
      if (typeof provider.fetchInboundMedia !== 'function') {
        return null;
      }
      const fetched = await provider.fetchInboundMedia({
        media,
        credentials,
      });
      if (!fetched) return null;

      // Store the audio bytes and expose them on the public media URL.
      const fileName = `voice-${params.externalMessageId}`;
      const stored = await imagesRepository.create({
        companyId,
        fileName,
        mimeType: fetched.mimeType,
        sizeBytes: fetched.buffer.length,
        data: fetched.buffer,
      });
      const mediaUrl = publicImageUrl(params.publicBaseUrl, stored.id);
      await prisma.message.updateMany({
        where: { id: messageId, companyId },
        data: { mediaUrl },
      });

      // Transcribe (optional — disabled/unconfigured returns null, never throws).
      const transcription = await aiTranscriptionService.transcribe({
        buffer: fetched.buffer,
        mimeType: fetched.mimeType,
        fileName,
      });
      if (!transcription || transcription.text.trim() === '') return null;

      await prisma.message.updateMany({
        where: { id: messageId, companyId },
        data: {
          content: transcription.text,
          metadata: {
            transcription: {
              model: transcription.model,
              transcribedAt: new Date().toISOString(),
            },
          } as Prisma.InputJsonValue,
        },
      });
      return transcription.text;
    } catch (err) {
      // Best-effort only — a failed download/transcription never fails the
      // webhook (the AUDIO message is already stored).
      logger.warn('webhook.audio.process.error', {
        companyId,
        messageId,
        error: err instanceof Error ? err.message : 'unknown',
      });
      return null;
    }
  },

  async processDeliveryStatus(
    account: ChannelAccount,
    event: NormalizedDeliveryStatusEvent,
    eventRowId: string,
    result: WebhookProcessingResult,
  ): Promise<void> {
    const companyId = account.companyId;
    const delivery = await channelsRepository.findDeliveryByExternalMessageId(
      companyId,
      account.providerKey,
      event.externalMessageId,
    );
    if (!delivery) {
      await channelsRepository.updateWebhookEvent(eventRowId, {
        status: 'IGNORED',
        processedAt: new Date(),
        normalizedPayload: {
          kind: 'delivery_status',
          matched: false,
        } as Prisma.InputJsonValue,
      });
      result.ignored += 1;
      return;
    }

    const now = event.timestamp ?? new Date();
    // Monotonic, idempotent status update: duplicate / out-of-order / late
    // callbacks and multiple acknowledgements are all handled safely.
    const outcome = await channelDeliveryService.applyExternalStatus(
      companyId,
      delivery,
      event.status,
      now,
    );

    await channelsRepository.updateWebhookEvent(eventRowId, {
      status: outcome.applied ? 'PROCESSED' : 'DUPLICATE',
      processedAt: new Date(),
      normalizedPayload: {
        kind: 'delivery_status',
        status: outcome.status,
        applied: outcome.applied,
      } as Prisma.InputJsonValue,
    });
    if (outcome.applied) result.processed += 1;
    else result.duplicates += 1;
  },

  async processReadReceipt(
    account: ChannelAccount,
    event: NormalizedReadReceiptEvent,
    eventRowId: string,
    result: WebhookProcessingResult,
  ): Promise<void> {
    const companyId = account.companyId;
    const delivery = await channelsRepository.findDeliveryByExternalMessageId(
      companyId,
      account.providerKey,
      event.externalMessageId,
    );
    if (!delivery) {
      await channelsRepository.updateWebhookEvent(eventRowId, {
        status: 'IGNORED',
        processedAt: new Date(),
        normalizedPayload: { kind: 'read_receipt', matched: false } as Prisma.InputJsonValue,
      });
      result.ignored += 1;
      return;
    }
    const now = event.timestamp ?? new Date();
    const outcome = await channelDeliveryService.applyExternalStatus(
      companyId,
      delivery,
      'read',
      now,
    );
    await channelsRepository.updateWebhookEvent(eventRowId, {
      status: outcome.applied ? 'PROCESSED' : 'DUPLICATE',
      processedAt: new Date(),
      normalizedPayload: {
        kind: 'read_receipt',
        applied: outcome.applied,
      } as Prisma.InputJsonValue,
    });
    if (outcome.applied) result.processed += 1;
    else result.duplicates += 1;
  },
};
