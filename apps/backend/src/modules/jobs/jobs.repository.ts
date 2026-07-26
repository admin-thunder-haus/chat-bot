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
  async claimDue(limit: number): Promise<Job[]> {
    return prisma.$queryRaw<Job[]>`
      UPDATE "jobs"
      SET status = 'RUNNING',
          attempts = attempts + 1,
          "startedAt" = NOW(),
          "updatedAt" = NOW()
      WHERE id IN (
        SELECT id FROM "jobs"
        WHERE status = 'QUEUED' AND "runAt" <= NOW()
        ORDER BY "runAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      RETURNING *
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
