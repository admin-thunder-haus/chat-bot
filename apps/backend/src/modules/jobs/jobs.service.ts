import type { Job, Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { jobsRepository } from './jobs.repository';
import { getJobHandler } from './jobs.registry';
import {
  PermanentJobError,
  type EnqueueOptions,
  type JobPayload,
  type JobType,
} from './jobs.types';

/**
 * Queue core: enqueue, and run a bounded batch of due jobs.
 *
 * `runDueJobs()` is a plain awaitable function, deliberately not tied to the
 * timer that normally drives it. That is what makes the queue testable without
 * sleeping: a test enqueues, calls runDueJobs(), and asserts. The timer lives
 * in jobs.worker.ts and does nothing except call this on an interval.
 */

/** Jobs claimed per pass. Bounded so one pass cannot run unbounded. */
const DEFAULT_BATCH_SIZE = 20;

/** A job RUNNING for longer than this was orphaned by a dead process. */
const STUCK_THRESHOLD_MS = 5 * 60 * 1000;

/** Failure messages are logged in full but stored truncated. */
const MAX_ERROR_LENGTH = 500;

export interface RunJobsResult {
  claimed: number;
  succeeded: number;
  retried: number;
  dead: number;
  recovered: number;
}

function truncate(value: string): string {
  return value.length > MAX_ERROR_LENGTH
    ? `${value.slice(0, MAX_ERROR_LENGTH - 1)}…`
    : value;
}

/**
 * Exponential backoff with proportional jitter, matching the channel delivery
 * engine's policy so operators only have one retry shape to reason about.
 */
export function retryDelayMs(attempt: number): number {
  const base = env.JOBS_BACKOFF_BASE_MS;
  const raw = base * Math.pow(env.JOBS_BACKOFF_FACTOR, Math.max(0, attempt - 1));
  const capped = Math.min(raw, env.JOBS_BACKOFF_MAX_MS);
  const jitter = capped * env.JOBS_BACKOFF_JITTER * Math.random();
  return Math.round(capped + jitter);
}

export const jobsService = {
  /**
   * Persist a job and return immediately. Callers must treat this as
   * fire-and-forget: it never runs the handler inline, so the HTTP response is
   * not waiting on the work.
   */
  async enqueue<T extends JobType>(
    type: T,
    companyId: string | null,
    payload: JobPayload<T>,
    options: EnqueueOptions = {},
  ): Promise<Job> {
    const job = await jobsRepository.enqueue({
      companyId,
      type,
      payload: payload as unknown as Prisma.InputJsonValue,
      runAt: new Date(Date.now() + (options.delayMs ?? 0)),
      maxAttempts: options.maxAttempts ?? env.JOBS_MAX_ATTEMPTS,
      dedupeKey: options.dedupeKey ?? null,
    });
    logger.debug('jobs.enqueued', { jobId: job.id, type, companyId });
    return job;
  },

  /**
   * Enqueue without ever throwing into the caller. Used on the request path:
   * failing to SCHEDULE background work must not fail the upload/webhook that
   * triggered it. Returns null when the enqueue itself failed.
   */
  async enqueueSafely<T extends JobType>(
    type: T,
    companyId: string | null,
    payload: JobPayload<T>,
    options: EnqueueOptions = {},
  ): Promise<Job | null> {
    try {
      return await this.enqueue(type, companyId, payload, options);
    } catch (err) {
      logger.error('jobs.enqueue.failed', {
        type,
        companyId,
        message: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },

  /**
   * Claim and execute one batch of due jobs. Never rejects — it is called from
   * a background timer, where an unhandled rejection is a process crash.
   */
  async runDueJobs(batchSize = DEFAULT_BATCH_SIZE): Promise<RunJobsResult> {
    const result: RunJobsResult = {
      claimed: 0,
      succeeded: 0,
      retried: 0,
      dead: 0,
      recovered: 0,
    };

    try {
      // Reclaim orphans first so their retry lands in this same pass.
      result.recovered = await jobsRepository.recoverStuck(
        new Date(Date.now() - STUCK_THRESHOLD_MS),
        batchSize,
      );

      const claimed = await jobsRepository.claimDue(batchSize);
      result.claimed = claimed.length;

      for (const job of claimed) {
        // Sequential on purpose: a single free instance shares one small
        // Prisma pool with the request path, and a burst of parallel PDF
        // parses or Whisper calls would starve it.
        // eslint-disable-next-line no-await-in-loop
        const outcome = await runOne(job);
        result[outcome] += 1;
      }
    } catch (err) {
      // A whole-pass failure means the database is unreachable; the worker's
      // backoff handles it from here.
      logger.error('jobs.run.failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }

    return result;
  },

  /**
   * Test helper: run passes until nothing is left to do. Handlers may enqueue
   * follow-up jobs (audio → auto-reply), so a single pass is not enough to
   * reach a settled state. Bounded so a job that re-enqueues itself forever
   * fails the test instead of hanging it.
   */
  async drainJobs(maxPasses = 20): Promise<RunJobsResult> {
    const total: RunJobsResult = {
      claimed: 0,
      succeeded: 0,
      retried: 0,
      dead: 0,
      recovered: 0,
    };
    for (let pass = 0; pass < maxPasses; pass += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await this.runDueJobs();
      total.claimed += r.claimed;
      total.succeeded += r.succeeded;
      total.retried += r.retried;
      total.dead += r.dead;
      total.recovered += r.recovered;
      if (r.claimed === 0 && r.recovered === 0) return total;
    }
    throw new Error(
      `drainJobs did not settle after ${maxPasses} passes — a handler is probably re-enqueueing itself`,
    );
  },

  /** Housekeeping: drop finished jobs older than the retention window. */
  async pruneFinishedJobs(): Promise<number> {
    const before = new Date(
      Date.now() - env.JOBS_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    return jobsRepository.pruneFinished(before);
  },
};

/** Execute one claimed job and record its outcome. */
async function runOne(
  job: Job,
): Promise<'succeeded' | 'retried' | 'dead'> {
  const handler = getJobHandler(job.type);
  if (!handler) {
    // An unknown type is a deploy mismatch, not a transient fault: a row
    // written by a newer version and claimed by an older one. Retrying would
    // spin until the attempts run out.
    await jobsRepository.markDead(
      job.id,
      `No handler registered for job type "${job.type}"`,
    );
    logger.error('jobs.handler.missing', { jobId: job.id, type: job.type });
    return 'dead';
  }

  try {
    await handler({
      companyId: job.companyId,
      payload: job.payload as never,
      job,
      attempt: job.attempts,
    });
    await jobsRepository.markSucceeded(job.id);
    logger.debug('jobs.succeeded', {
      jobId: job.id,
      type: job.type,
      attempt: job.attempts,
    });
    return 'succeeded';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const permanent = err instanceof PermanentJobError;
    const exhausted = job.attempts >= job.maxAttempts;

    if (permanent || exhausted) {
      await jobsRepository.markDead(job.id, truncate(message));
      logger.error('jobs.dead', {
        jobId: job.id,
        type: job.type,
        companyId: job.companyId,
        attempts: job.attempts,
        permanent,
        message,
      });
      return 'dead';
    }

    const delay = retryDelayMs(job.attempts);
    await jobsRepository.markForRetry(
      job.id,
      new Date(Date.now() + delay),
      truncate(message),
    );
    logger.warn('jobs.retry', {
      jobId: job.id,
      type: job.type,
      companyId: job.companyId,
      attempt: job.attempts,
      retryInMs: delay,
      message,
    });
    return 'retried';
  }
}
