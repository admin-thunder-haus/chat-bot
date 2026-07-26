import { env, isJobsWorkerEnabled } from '../../config/env';
import { logger } from '../../utils/logger';
import { jobsService } from './jobs.service';

/**
 * The timer that drives the queue. Deliberately identical in shape to
 * channel-retry.scheduler (interval + unref + in-flight guard + never throws)
 * so there is one pattern to understand for every background loop here.
 *
 * The worker runs IN the API process. On a single instance that is the right
 * trade: no extra service to pay for or deploy, and the queue table is the
 * durable part — a restart loses nothing, it only pauses processing.
 */

/** Consecutive failed passes tolerated before backing off. */
const BACKOFF_AFTER_FAILURES = 3;
const MAX_SKIPPED_TICKS = 10;

/** Prune roughly once an hour, derived from the tick interval. */
const PRUNE_EVERY_TICKS = Math.max(
  1,
  Math.round(3_600_000 / Math.max(1, env.JOBS_POLL_MS)),
);

let timer: NodeJS.Timeout | null = null;
let passInFlight = false;
let consecutiveFailures = 0;
let ticksToSkip = 0;
let ticksSincePrune = 0;

/**
 * Run one pass. Never rejects. Exported so tests and any future admin trigger
 * can drive the worker deterministically instead of waiting on the interval.
 */
export async function runWorkerPass(): Promise<{ ran: boolean }> {
  if (passInFlight) {
    logger.debug('jobs.worker.skipped', { reason: 'in_flight' });
    return { ran: false };
  }
  passInFlight = true;
  const startedAt = Date.now();

  try {
    const result = await jobsService.runDueJobs();
    // Only a pass that moved something is worth an info line — at one tick
    // every few seconds an unconditional log would bury everything else.
    if (result.claimed > 0 || result.recovered > 0) {
      logger.info('jobs.worker.pass', {
        ...result,
        durationMs: Date.now() - startedAt,
      });
    }
    consecutiveFailures = 0;
    ticksToSkip = 0;
    return { ran: true };
  } catch (err) {
    // runDueJobs already swallows its own errors; this is the last line of
    // defence, because an unhandled rejection in a timer kills the process.
    consecutiveFailures += 1;
    if (consecutiveFailures >= BACKOFF_AFTER_FAILURES) {
      ticksToSkip = Math.min(
        consecutiveFailures - BACKOFF_AFTER_FAILURES + 1,
        MAX_SKIPPED_TICKS,
      );
    }
    logger.error('jobs.worker.pass.failed', {
      message: err instanceof Error ? err.message : String(err),
      consecutiveFailures,
    });
    return { ran: false };
  } finally {
    passInFlight = false;
  }
}

function tick(): void {
  if (ticksToSkip > 0) {
    ticksToSkip -= 1;
    logger.debug('jobs.worker.skipped', {
      reason: 'backoff',
      remainingSkips: ticksToSkip,
    });
    return;
  }

  void runWorkerPass().then(() => {
    ticksSincePrune += 1;
    if (ticksSincePrune < PRUNE_EVERY_TICKS) return;
    ticksSincePrune = 0;
    // Housekeeping rides along on the existing timer rather than adding a
    // second always-on loop for a query that runs once an hour.
    return jobsService
      .pruneFinishedJobs()
      .then((deleted) => {
        if (deleted > 0) logger.info('jobs.pruned', { deleted });
      })
      .catch((err: unknown) => {
        logger.warn('jobs.prune.failed', {
          message: err instanceof Error ? err.message : String(err),
        });
      });
  });
}

/**
 * Start the worker. Idempotent, and a no-op when disabled (always disabled
 * under tests — see isJobsWorkerEnabled). Returns whether it is now running.
 */
export function startJobsWorker(): boolean {
  if (!isJobsWorkerEnabled()) {
    logger.info('Background job worker disabled');
    return false;
  }
  if (timer) return true;

  consecutiveFailures = 0;
  ticksToSkip = 0;
  ticksSincePrune = 0;
  timer = setInterval(tick, env.JOBS_POLL_MS);
  // Never be the reason the process stays alive.
  timer.unref();
  logger.info('Background job worker started', {
    pollMs: env.JOBS_POLL_MS,
    batchNote: 'jobs run sequentially to protect the shared Prisma pool',
  });
  return true;
}

/**
 * Stop the worker. Safe when never started. An in-flight pass is left to
 * finish; each job's state transition is committed on its own, so nothing is
 * lost even if the process dies mid-pass (the job returns to QUEUED via
 * recoverStuck).
 */
export function stopJobsWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  consecutiveFailures = 0;
  ticksToSkip = 0;
  logger.info('Background job worker stopped');
}
