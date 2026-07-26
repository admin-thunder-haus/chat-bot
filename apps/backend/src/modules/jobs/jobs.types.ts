import type { Job } from '@prisma/client';
import type { NormalizedIncomingMedia } from '../channels/providers/channel-provider.interface';

/**
 * Job catalog. Kept in a tiny module with no service imports (same reason as
 * domain-events.types) so the registry, repository and docs can reference the
 * list without pulling handler wiring — and therefore the whole app — in.
 */
export const JOB_TYPES = [
  /** Extract + chunk an uploaded knowledge PDF. */
  'knowledge-document.extract',
  /** Download an inbound voice note, store it, transcribe it, then auto-reply. */
  'channel.inbound-audio',
  /** Generate an AI auto-reply for a freshly-stored inbound message. */
  'ai.auto-reply',
  /** Deliver one signed outbound webhook attempt. */
  'webhook.dispatch',
] as const;

export type JobType = (typeof JOB_TYPES)[number];

/**
 * Payloads carry IDS, never entities, buffers or credentials. A job row can
 * outlive the process that wrote it, so a handler re-reads current state rather
 * than acting on a snapshot that may be minutes stale — and the job table never
 * becomes a place secrets or megabytes of file data live.
 *
 * The one exception is the inbound-media descriptor: it is the provider's own
 * small, non-secret pointer to the audio (a CDN url or a provider media id) and
 * cannot be re-derived without re-parsing the raw webhook body.
 */
export interface JobPayloads {
  'knowledge-document.extract': { documentId: string };
  'channel.inbound-audio': {
    messageId: string;
    channelAccountId: string;
    providerKey: string;
    externalMessageId: string;
    media: NormalizedIncomingMedia;
    /** This API's own public origin, used to build the stored media URL. */
    publicBaseUrl: string;
  };
  'ai.auto-reply': { messageId: string };
  'webhook.dispatch': { deliveryId: string };
}

export type JobPayload<T extends JobType> = JobPayloads[T];

/**
 * A handler receives the tenant explicitly (never inferred from the payload)
 * and its typed payload. It must be IDEMPOTENT: a job can be delivered more
 * than once when a process dies mid-attempt, so re-running a completed job has
 * to be a harmless no-op.
 *
 * Throwing schedules a retry. To fail permanently without burning the
 * remaining attempts, throw a PermanentJobError.
 */
export type JobHandler<T extends JobType = JobType> = (ctx: {
  companyId: string | null;
  payload: JobPayload<T>;
  job: Job;
  /** 1 on the first run. Handlers use it to log or to give up early. */
  attempt: number;
}) => Promise<void>;

/**
 * Thrown by a handler when retrying cannot possibly help — a deleted record, a
 * malformed payload, an unsupported file. The job goes straight to DEAD with
 * the reason recorded, instead of retrying five times to reach the same place.
 */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

export interface EnqueueOptions {
  /** Delay before the job first becomes eligible (ms). */
  delayMs?: number;
  /** Overrides the default attempt budget for this one job. */
  maxAttempts?: number;
  /**
   * Idempotency key, scoped to the job type. Enqueuing the same key twice
   * returns the existing job instead of creating a duplicate — this is what
   * makes a retried webhook delivery safe to re-enqueue.
   */
  dedupeKey?: string;
}
