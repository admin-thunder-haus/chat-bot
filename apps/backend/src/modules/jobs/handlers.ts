import { knowledgeDocumentsService } from '../knowledge-documents/knowledge-documents.service';
import { channelPipelineService } from '../channels/channel-pipeline.service';
import { webhookService } from '../channels/webhooks/webhook.service';
import { registerJobHandler } from './jobs.registry';
import { PermanentJobError } from './jobs.types';

/**
 * Handler wiring. Imported for its side effects by modules/jobs/index.ts, which
 * keeps the queue core free of any feature import — the dependency arrow points
 * feature → queue, never the other way.
 *
 * Every handler is IDEMPOTENT: a job may be delivered twice when a process dies
 * mid-attempt, so re-running one must be a harmless no-op.
 */

/**
 * PDF text extraction + chunking. Previously ran inline inside the upload
 * request, where one 10 MB PDF held an HTTP connection (and a Prisma
 * connection) for the whole parse.
 */
registerJobHandler('knowledge-document.extract', async ({ companyId, payload }) => {
  if (!companyId) {
    throw new PermanentJobError('knowledge-document.extract requires a companyId');
  }
  await knowledgeDocumentsService.runExtraction(companyId, payload.documentId);
});

/**
 * Inbound voice note: download the audio through the provider, store it,
 * transcribe it, then queue the auto-reply. Previously ran inline inside the
 * provider's webhook request — a Whisper call on the critical path, which is
 * exactly the kind of latency that makes Meta mark an endpoint as failing.
 */
registerJobHandler('channel.inbound-audio', async ({ companyId, payload }) => {
  if (!companyId) {
    throw new PermanentJobError('channel.inbound-audio requires a companyId');
  }
  await webhookService.processInboundAudioJob({
    companyId,
    messageId: payload.messageId,
    channelAccountId: payload.channelAccountId,
    providerKey: payload.providerKey,
    externalMessageId: payload.externalMessageId,
    media: payload.media,
    publicBaseUrl: payload.publicBaseUrl,
  });
});

/**
 * AI auto-reply for a stored inbound message. maybeAutoReply never throws — it
 * records its own FAILED generation row — so a successful job here means "the
 * attempt was made", not "a reply was produced". That is deliberate: retrying a
 * refused reply (AI off, handed off to a human, quota reached) would be wrong.
 */
registerJobHandler('ai.auto-reply', async ({ companyId, payload }) => {
  if (!companyId) {
    throw new PermanentJobError('ai.auto-reply requires a companyId');
  }
  await channelPipelineService.maybeAutoReply(companyId, payload.messageId);
});
