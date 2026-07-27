import type { Job, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';

/**
 * Every SQL statement the queue needs. The only interesting one is `claimDue`:
 * it must hand a job to exactly ONE worker even with several running, which is
 * what `FOR UPDATE SKIP LOCKED` buys — contending workers step over locked
 * rows instead of blocking on them or double-claiming.
 *
 * This file is the seam a different transport would replace.
 */
export const jobsRepository = {
  /** Insert a job, or return the existing one when its dedupeKey collides. */
  async enqueue(data: {
    companyId: string | null;
    type: string;
    payload: Prisma.InputJsonValue;
    runAt: Date;
    maxAttempts: number;
    dedupeKey: string | null;
  }): Promise<Job> {
    if (data.dedupeKey === null) {
      return prisma.job.create({ data });
    }
    // upsert on (type, dedupeKey): a repeat enqueue leaves the original row —
    // including its attempt count — completely untouched.
    return prisma.job.upsert({
      where: { type_dedupeKey: { type: data.type, dedupeKey: data.dedupeKey } },
      update: {},
      create: data,
    });
  },

  /**
   * Atomically claim up to `limit` due jobs: flip them to RUNNING and increment
   * `attempts` in the same statement that selects them, so a crash between
   * claim and execution still burns an attempt and cannot loop forever.
   */
  /**
   * Claim at most `limit` due jobs for this worker.
   *
   * The candidate SELECT lives in a CTE rather than an `IN (SELECT …)`
   * subquery. Both look equivalent, but only the CTE is GUARANTEED to run
   * exactly once: a sub-select can legally be planned as a semi-join and
   * re-scanned, and a re-scanned `FOR UPDATE SKIP LOCKED … LIMIT n` can hand
   * back more than n rows. A batch size that is not actually a bound is worth
   * nothing — it exists to stop one pass from monopolising the single Prisma
   * pool this instance shares with the request path.
   *
   * (This replaced a sub-select form after `runDueJobs(2)` was observed
   * returning 3 claimed jobs in CI. That was never reproduced on demand, so
   * the CTE is defence against the only mechanism that could produce it,
   * not a confirmed fix — see the note in jobs-queue.test.ts.)
   */
  async claimDue(limit: number): Promise<Job[]> {
    return prisma.$queryRaw<Job[]>`
      WITH due AS (
        SELECT id FROM "jobs"
        WHERE status = 'QUEUED' AND "runAt" <= NOW()
        ORDER BY "runAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "jobs" j
      SET status = 'RUNNING',
          attempts = j.attempts + 1,
          "startedAt" = NOW(),
          "updatedAt" = NOW()
      FROM due
      WHERE j.id = due.id
      RETURNING j.*
    `;
  },

  async markSucceeded(id: string): Promise<void> {
    await prisma.job.update({
      where: { id },
      data: { status: 'SUCCEEDED', finishedAt: new Date(), lastError: null },
    });
  },

  /** Schedule another attempt at `runAt`. */
  async markForRetry(id: string, runAt: Date, error: string): Promise<void> {
    await prisma.job.update({
      where: { id },
      data: { status: 'QUEUED', runAt, lastError: error, startedAt: null },
    });
  },

  /** Terminal failure: attempts exhausted, or a PermanentJobError. */
  async markDead(id: string, error: string): Promise<void> {
    await prisma.job.update({
      where: { id },
      data: { status: 'DEAD', finishedAt: new Date(), lastError: error },
    });
  },

  /**
   * Re-queue jobs stuck in RUNNING past `cutoff` — the process died mid-attempt
   * and nothing else will ever finish them. `attempts` was already incremented
   * at claim time, so a job that reliably kills the process still reaches DEAD
   * rather than crash-looping forever.
   */
  async recoverStuck(cutoff: Date, limit: number): Promise<number> {
    const stuck = await prisma.job.findMany({
      where: { status: 'RUNNING', startedAt: { lt: cutoff } },
      select: { id: true, attempts: true, maxAttempts: true },
      take: limit,
    });
    if (stuck.length === 0) return 0;

    const exhausted = stuck.filter((j) => j.attempts >= j.maxAttempts);
    const retryable = stuck.filter((j) => j.attempts < j.maxAttempts);

    if (exhausted.length > 0) {
      await prisma.job.updateMany({
        where: { id: { in: exhausted.map((j) => j.id) } },
        data: {
          status: 'DEAD',
          finishedAt: new Date(),
          lastError: 'Abandoned: the worker died mid-attempt',
        },
      });
    }
    if (retryable.length > 0) {
      await prisma.job.updateMany({
        where: { id: { in: retryable.map((j) => j.id) } },
        data: {
          status: 'QUEUED',
          runAt: new Date(),
          startedAt: null,
          lastError: 'Requeued after the worker died mid-attempt',
        },
      });
    }
    return stuck.length;
  },

  /** Housekeeping: drop finished jobs so the table cannot grow forever. */
  async pruneFinished(before: Date): Promise<number> {
    const { count } = await prisma.job.deleteMany({
      where: { status: { in: ['SUCCEEDED', 'FAILED'] }, finishedAt: { lt: before } },
    });
    return count;
  },

  findById(id: string): Promise<Job | null> {
    return prisma.job.findUnique({ where: { id } });
  },

  countByStatus(status: Job['status']): Promise<number> {
    return prisma.job.count({ where: { status } });
  },
};
