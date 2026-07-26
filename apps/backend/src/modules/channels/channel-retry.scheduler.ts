import { env, isChannelRetrySweepEnabled } from '../../config/env';
import { logger } from '../../utils/logger';
import { channelDeliveryService } from './channel-delivery.service';

/**
 * In-process retry sweeper — the TIMER half of the delivery retry story
 * (`channel-retry.service` owns the POLICY: how long to wait, how many times).
 *
 * Without it, `nextAttemptAt` is written but never read: a delivery that failed
 * transiently waits forever, and on Render's free tier (which sleeps and
 * restarts) that is silent data loss. A single-process interval is deliberate —
 * the delivery engine already claims work atomically, so moving this to a real
 * queue later means swapping this file, nothing else.
 */

/** Deliveries handled per sweep. Bounded so one tick can never run unbounded. */
const SWEEP_BATCH_SIZE = 50;

/**
 * A delivery left in SENDING for longer than this was orphaned by a crash or a
 * restart mid-attempt. Kept independent of the sweep interval: it describes how
 * long a *send* may plausibly take, not how often we look.
 */
const STUCK_THRESHOLD_MS = 60_000;

/**
 * Consecutive failed sweeps tolerated before backing off. A sweep only fails
 * wholesale when the database is unreachable, so a couple of blips are noise.
 */
const BACKOFF_AFTER_FAILURES = 3;

/** Upper bound on consecutive skipped ticks (10 minutes at the 60s default). */
const MAX_SKIPPED_TICKS = 10;

export interface ChannelRetrySweepResult {
  /** `skipped` = nothing ran (overlap); `failed` = the sweep threw (swallowed). */
  status: 'ran' | 'skipped' | 'failed';
  /** Skip reason, or the error message when the sweep failed. */
  reason?: string;
  /** Due deliveries re-attempted this sweep. */
  processed: number;
  /** Deliveries orphaned in SENDING that were re-queued. */
  recovered: number;
  /** Re-attempts that ended terminally (failed / expired) this sweep. */
  failures: number;
  durationMs: number;
}

let timer: NodeJS.Timeout | null = null;
/** Guard: one sweep at a time, so a slow sweep can never stack on itself. */
let sweepInFlight = false;
let consecutiveFailures = 0;
let ticksToSkip = 0;

function emptyResult(
  status: ChannelRetrySweepResult['status'],
  reason: string,
  durationMs = 0,
): ChannelRetrySweepResult {
  return { status, reason, processed: 0, recovered: 0, failures: 0, durationMs };
}

/**
 * Run exactly one sweep and resolve with what it did. Never rejects — a
 * background timer that can throw takes the whole process down with it.
 * Exported so tests (and any future admin trigger) can drive a sweep
 * deterministically without waiting on a timer.
 */
export async function runSweepOnce(): Promise<ChannelRetrySweepResult> {
  if (sweepInFlight) {
    logger.debug('channel.retry.sweep.skipped', { reason: 'in_flight' });
    return emptyResult('skipped', 'in_flight');
  }
  sweepInFlight = true;
  const startedAt = Date.now();

  try {
    // Recovery first: a re-queued delivery gets nextAttemptAt=now, so the very
    // same sweep picks it up instead of waiting a full interval.
    const { recovered } = await channelDeliveryService.recoverStuckDeliveries(
      STUCK_THRESHOLD_MS,
      undefined,
      SWEEP_BATCH_SIZE,
    );
    // No companyId: the sweeper is platform-wide, tenant scoping lives in the
    // rows themselves (each attempt is executed under its own companyId).
    const { processed, results } = await channelDeliveryService.runDueRetries(
      undefined,
      SWEEP_BATCH_SIZE,
    );
    const failures = results.filter(
      (r) => r.status === 'failed' || r.status === 'expired',
    ).length;
    const durationMs = Date.now() - startedAt;

    // Only a sweep that actually moved something is worth a line: at one tick a
    // minute an unconditional log is ~1400 useless lines a day forever. Idle
    // sweeps drop to debug, which is where "is the sweeper alive?" belongs.
    const summary = { processed, recovered, failures, durationMs };
    if (processed > 0 || recovered > 0) {
      logger.info('channel.retry.sweep', summary);
    } else {
      logger.debug('channel.retry.sweep.idle', summary);
    }

    return { status: 'ran', processed, recovered, failures, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    logger.error('channel.retry.sweep.failed', { message, durationMs });
    return emptyResult('failed', message, durationMs);
  } finally {
    sweepInFlight = false;
  }
}

/**
 * One timer tick: honour the backoff, then run a sweep and fold its outcome
 * back into the failure counter.
 */
function tick(): void {
  if (ticksToSkip > 0) {
    ticksToSkip -= 1;
    logger.debug('channel.retry.sweep.skipped', {
      reason: 'backoff',
      remainingSkips: ticksToSkip,
      consecutiveFailures,
    });
    return;
  }

  void runSweepOnce()
    .then((result) => {
      if (result.status === 'failed') {
        consecutiveFailures += 1;
        if (consecutiveFailures >= BACKOFF_AFTER_FAILURES) {
          // Linear, not exponential: the only realistic cause is the database
          // being down, and we want to notice it coming back within minutes.
          // 1 skipped tick after the 3rd failure, 2 after the 4th, capped.
          ticksToSkip = Math.min(
            consecutiveFailures - BACKOFF_AFTER_FAILURES + 1,
            MAX_SKIPPED_TICKS,
          );
        }
        return;
      }
      if (result.status === 'ran') {
        consecutiveFailures = 0;
        ticksToSkip = 0;
      }
    })
    // Defensive only: runSweepOnce already swallows everything, but an
    // unhandled rejection here would be an unrecoverable process crash.
    .catch((err: unknown) => {
      logger.error('channel.retry.sweep.tick_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    });
}

/**
 * Start the sweeper. Idempotent, and a no-op when disabled (always disabled
 * under tests — see isChannelRetrySweepEnabled). Returns whether a timer is
 * now running.
 */
export function startChannelRetryScheduler(): boolean {
  if (!isChannelRetrySweepEnabled()) {
    logger.info('Channel retry sweeper disabled');
    return false;
  }
  if (timer) return true;

  consecutiveFailures = 0;
  ticksToSkip = 0;
  timer = setInterval(tick, env.CHANNEL_RETRY_SWEEP_MS);
  // unref so the sweeper is never the reason the process stays alive — a
  // finished script or a drained server must still be able to exit.
  timer.unref();
  logger.info('Channel retry sweeper started', {
    intervalMs: env.CHANNEL_RETRY_SWEEP_MS,
  });
  return true;
}

/**
 * Stop the sweeper. Safe to call when it was never started. An in-flight sweep
 * is left to finish (it is short and its transitions are atomic); only the
 * timer is cleared.
 */
export function stopChannelRetryScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  consecutiveFailures = 0;
  ticksToSkip = 0;
  logger.info('Channel retry sweeper stopped');
}
