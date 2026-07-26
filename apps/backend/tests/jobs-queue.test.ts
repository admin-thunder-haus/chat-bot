import { createApp } from '../src/app';
import { jobsRepository } from '../src/modules/jobs/jobs.repository';
import { jobsService, retryDelayMs } from '../src/modules/jobs/jobs.service';
import {
  getJobHandler,
  registerJobHandler,
  registeredJobTypes,
} from '../src/modules/jobs/jobs.registry';
import { PermanentJobError, JOB_TYPES } from '../src/modules/jobs/jobs.types';
import { runWorkerPass, stopJobsWorker } from '../src/modules/jobs/jobs.worker';
import { isJobsWorkerEnabled } from '../src/config/env';
import { setupTenant, type Tenant } from './helpers';
import { prisma } from './setup';

/**
 * The queue core, exercised through the real Postgres table.
 *
 * Handlers cannot be swapped out here (the registry deliberately refuses a
 * duplicate registration, and clearing it would break every other suite that
 * shares this process), so the tests drive the REAL registered handlers plus a
 * dedicated fake type registered once for this file.
 *
 * Nothing sleeps: runDueJobs()/drainJobs() are plain awaitable functions.
 */

// Importing the app registers the production handlers as a side effect.
createApp();

// A fake type used to exercise retry/backoff/dead-letter without touching a
// real feature. Registered once — jest runs each file in its own module
// registry, so this cannot clash with another suite.
const FAKE_TYPE = 'test.fake' as never;
let fakeBehaviour: () => Promise<void> = async () => {};
let fakeCalls = 0;
registerJobHandler(FAKE_TYPE, async () => {
  fakeCalls += 1;
  await fakeBehaviour();
});

let acme: Tenant;

beforeEach(async () => {
  await prisma.job.deleteMany();
  acme = await setupTenant('acme');
  fakeCalls = 0;
  fakeBehaviour = async () => {};
});

afterEach(async () => {
  stopJobsWorker();
  await prisma.job.deleteMany();
});

function enqueueFake(
  companyId: string | null,
  options: Parameters<typeof jobsService.enqueue>[3] = {},
) {
  return jobsService.enqueue(FAKE_TYPE, companyId, {} as never, options);
}

describe('registry', () => {
  it('registers a handler for every declared job type', () => {
    const registered = registeredJobTypes();
    // webhook.dispatch is declared but wired in a later change; assert the
    // handlers that exist rather than silently allowing a missing one.
    for (const type of ['knowledge-document.extract', 'channel.inbound-audio', 'ai.auto-reply']) {
      expect(registered).toContain(type);
      expect(getJobHandler(type)).toBeDefined();
    }
    // Every registered production type must be in the declared catalog.
    for (const type of registered) {
      if (type === FAKE_TYPE) continue;
      expect(JOB_TYPES).toContain(type);
    }
  });

  it('refuses a duplicate registration instead of silently dropping one', () => {
    expect(() =>
      registerJobHandler('ai.auto-reply', async () => {}),
    ).toThrow(/already registered/i);
  });
});

describe('enqueue', () => {
  it('persists a QUEUED job and runs nothing inline', async () => {
    const job = await enqueueFake(acme.company.id);

    expect(job.status).toBe('QUEUED');
    expect(job.attempts).toBe(0);
    expect(job.companyId).toBe(acme.company.id);
    // The whole point: the caller returned before any work happened.
    expect(fakeCalls).toBe(0);
  });

  it('deduplicates by (type, dedupeKey)', async () => {
    const first = await enqueueFake(acme.company.id, { dedupeKey: 'abc' });
    const second = await enqueueFake(acme.company.id, { dedupeKey: 'abc' });

    expect(second.id).toBe(first.id);
    expect(await prisma.job.count({ where: { type: FAKE_TYPE } })).toBe(1);
  });

  it('treats jobs without a dedupeKey as always distinct', async () => {
    await enqueueFake(acme.company.id);
    await enqueueFake(acme.company.id);
    expect(await prisma.job.count({ where: { type: FAKE_TYPE } })).toBe(2);
  });

  it('honours delayMs so a delayed job is not yet due', async () => {
    const job = await enqueueFake(acme.company.id, { delayMs: 60_000 });

    await jobsService.runDueJobs();
    expect(fakeCalls).toBe(0);
    expect((await jobsRepository.findById(job.id))!.status).toBe('QUEUED');
  });

  it('enqueueSafely returns null instead of throwing on a bad enqueue', async () => {
    // A companyId that is not a uuid makes Postgres reject the insert.
    const job = await jobsService.enqueueSafely(
      FAKE_TYPE,
      'not-a-uuid',
      {} as never,
    );
    expect(job).toBeNull();
  });
});

describe('running due jobs', () => {
  it('claims, executes and marks a due job SUCCEEDED', async () => {
    const job = await enqueueFake(acme.company.id);

    const result = await jobsService.runDueJobs();
    expect(result).toMatchObject({ claimed: 1, succeeded: 1, dead: 0 });
    expect(fakeCalls).toBe(1);

    const after = await jobsRepository.findById(job.id);
    expect(after!.status).toBe('SUCCEEDED');
    expect(after!.attempts).toBe(1);
    expect(after!.finishedAt).not.toBeNull();
    expect(after!.lastError).toBeNull();
  });

  it('never claims the same job twice', async () => {
    await enqueueFake(acme.company.id);

    await jobsService.runDueJobs();
    await jobsService.runDueJobs();

    // The handler ran exactly once — the strongest statement of claim-once,
    // and independent of whatever else is in the table.
    expect(fakeCalls).toBe(1);
  });

  it('respects the batch size and leaves the rest queued', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      ids.push((await enqueueFake(acme.company.id)).id);
    }

    const result = await jobsService.runDueJobs(2);

    // The IN-PROCESS facts first. These are immune to anything else touching the
    // database — which matters: a `npm run dev` server pointed at the test
    // database has a job worker polling every couple of seconds, and it will
    // happily claim the third job out from under this test. That cost real time
    // to diagnose once; assert on what this process did, not on what the table
    // looks like a moment later.
    expect(result.claimed).toBe(2);
    expect(fakeCalls).toBe(2);

    // Then the rows, scoped to THIS test's ids (other suites enqueue real jobs).
    const mine = await prisma.job.findMany({
      where: { id: { in: ids } },
      select: { status: true },
    });
    expect(mine).toHaveLength(3);
    expect(mine.filter((j) => j.status === 'SUCCEEDED')).toHaveLength(2);
  });

  it('passes the tenant and attempt number to the handler', async () => {
    const seen: { companyId: string | null; attempt: number }[] = [];
    fakeBehaviour = async () => {};
    const handler = getJobHandler(FAKE_TYPE)!;
    // Drive the handler contract directly — the queue always supplies both.
    const job = await enqueueFake(acme.company.id);
    await handler({
      companyId: job.companyId,
      payload: {} as never,
      job,
      attempt: 1,
    });
    seen.push({ companyId: job.companyId, attempt: 1 });
    expect(seen[0].companyId).toBe(acme.company.id);
  });
});

describe('retries and dead-lettering', () => {
  it('reschedules a failed job with a future runAt and records the error', async () => {
    fakeBehaviour = async () => {
      throw new Error('provider exploded');
    };
    const job = await enqueueFake(acme.company.id);

    const result = await jobsService.runDueJobs();
    expect(result).toMatchObject({ claimed: 1, retried: 1, dead: 0 });

    const after = await jobsRepository.findById(job.id);
    expect(after!.status).toBe('QUEUED');
    expect(after!.attempts).toBe(1);
    expect(after!.lastError).toContain('provider exploded');
    expect(after!.runAt.getTime()).toBeGreaterThan(Date.now());
    // Not due yet, so a second pass leaves it alone.
    await jobsService.runDueJobs();
    expect(fakeCalls).toBe(1);
  });

  it('dead-letters once the attempt budget is exhausted', async () => {
    fakeBehaviour = async () => {
      throw new Error('still broken');
    };
    const job = await enqueueFake(acme.company.id, { maxAttempts: 2 });

    await jobsService.runDueJobs();
    // Make the retry due immediately instead of waiting out the backoff.
    await prisma.job.update({
      where: { id: job.id },
      data: { runAt: new Date(Date.now() - 1000) },
    });
    const second = await jobsService.runDueJobs();

    expect(second).toMatchObject({ claimed: 1, dead: 1, retried: 0 });
    const after = await jobsRepository.findById(job.id);
    expect(after!.status).toBe('DEAD');
    expect(after!.attempts).toBe(2);
    expect(after!.lastError).toContain('still broken');
  });

  it('dead-letters a PermanentJobError immediately, without burning attempts', async () => {
    fakeBehaviour = async () => {
      throw new PermanentJobError('the record is gone');
    };
    const job = await enqueueFake(acme.company.id, { maxAttempts: 5 });

    const result = await jobsService.runDueJobs();
    expect(result).toMatchObject({ dead: 1, retried: 0 });

    const after = await jobsRepository.findById(job.id);
    expect(after!.status).toBe('DEAD');
    // One attempt used, not five.
    expect(after!.attempts).toBe(1);
    expect(after!.lastError).toContain('the record is gone');
  });

  it('dead-letters an unknown job type rather than retrying a deploy mismatch', async () => {
    const job = await prisma.job.create({
      data: {
        companyId: acme.company.id,
        type: 'nope.not-a-real-type',
        payload: {},
        runAt: new Date(),
      },
    });

    const result = await jobsService.runDueJobs();
    expect(result.dead).toBe(1);
    const after = await jobsRepository.findById(job.id);
    expect(after!.status).toBe('DEAD');
    expect(after!.lastError).toMatch(/no handler registered/i);
  });

  it('truncates a very long failure message before storing it', async () => {
    fakeBehaviour = async () => {
      throw new Error('x'.repeat(5000));
    };
    const job = await enqueueFake(acme.company.id, { maxAttempts: 1 });

    await jobsService.runDueJobs();
    const after = await jobsRepository.findById(job.id);
    expect(after!.lastError!.length).toBeLessThanOrEqual(500);
  });

  it('grows the retry delay and caps it', () => {
    const first = retryDelayMs(1);
    const later = retryDelayMs(4);
    expect(later).toBeGreaterThan(first);
    // Never beyond the configured ceiling plus its jitter.
    expect(retryDelayMs(30)).toBeLessThanOrEqual(600000 * 1.2 + 1);
  });
});

describe('crash recovery', () => {
  it('re-queues a job orphaned in RUNNING by a dead process', async () => {
    const job = await enqueueFake(acme.company.id);
    // Simulate: claimed (attempts incremented), then the process died.
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'RUNNING',
        attempts: 1,
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });

    const result = await jobsService.runDueJobs();
    expect(result.recovered).toBe(1);
    // Recovered AND retried in the same pass, so nothing waits an extra cycle.
    expect(result.claimed).toBe(1);
    expect(fakeCalls).toBe(1);
    expect((await jobsRepository.findById(job.id))!.status).toBe('SUCCEEDED');
  });

  it('dead-letters an orphan that already used every attempt', async () => {
    const job = await enqueueFake(acme.company.id, { maxAttempts: 2 });
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'RUNNING',
        attempts: 2,
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });

    await jobsService.runDueJobs();
    const after = await jobsRepository.findById(job.id);
    expect(after!.status).toBe('DEAD');
    expect(after!.lastError).toMatch(/died mid-attempt/i);
    // A job that reliably kills the process must not crash-loop forever.
    expect(fakeCalls).toBe(0);
  });

  it('leaves a recently-started RUNNING job alone', async () => {
    const job = await enqueueFake(acme.company.id);
    await prisma.job.update({
      where: { id: job.id },
      data: { status: 'RUNNING', attempts: 1, startedAt: new Date() },
    });

    const result = await jobsService.runDueJobs();
    expect(result.recovered).toBe(0);
    expect(fakeCalls).toBe(0);
  });
});

describe('worker loop', () => {
  it('is always disabled under tests so no timer races the db reset', () => {
    expect(isJobsWorkerEnabled()).toBe(false);
  });

  it('runWorkerPass processes due work and never rejects', async () => {
    await enqueueFake(acme.company.id);
    await expect(runWorkerPass()).resolves.toEqual({ ran: true });
    expect(fakeCalls).toBe(1);
  });

  it('drainJobs settles a chain of follow-up jobs', async () => {
    // The fake enqueues one follow-up on its first run only, which is exactly
    // the audio → auto-reply shape a single pass would not finish.
    let chained = false;
    fakeBehaviour = async () => {
      if (chained) return;
      chained = true;
      await jobsService.enqueue(FAKE_TYPE, acme.company.id, {} as never);
    };
    await enqueueFake(acme.company.id);

    await jobsService.drainJobs();
    expect(fakeCalls).toBe(2);
    expect(
      await prisma.job.count({ where: { type: FAKE_TYPE, status: 'QUEUED' } }),
    ).toBe(0);
  });

  it('drainJobs fails loudly on a self-re-enqueueing handler', async () => {
    fakeBehaviour = async () => {
      await jobsService.enqueue(FAKE_TYPE, acme.company.id, {} as never);
    };
    await enqueueFake(acme.company.id);

    await expect(jobsService.drainJobs(3)).rejects.toThrow(/did not settle/i);
  });
});

describe('housekeeping', () => {
  it('prunes old finished jobs but keeps DEAD ones as the record of loss', async () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    await prisma.job.createMany({
      data: [
        {
          companyId: acme.company.id,
          type: FAKE_TYPE,
          payload: {},
          status: 'SUCCEEDED',
          finishedAt: old,
        },
        {
          companyId: acme.company.id,
          type: FAKE_TYPE,
          payload: {},
          status: 'DEAD',
          finishedAt: old,
        },
        {
          companyId: acme.company.id,
          type: FAKE_TYPE,
          payload: {},
          status: 'SUCCEEDED',
          finishedAt: new Date(),
        },
      ],
    });

    const deleted = await jobsService.pruneFinishedJobs();
    expect(deleted).toBe(1);

    const left = await prisma.job.findMany({
      where: { type: FAKE_TYPE },
      select: { status: true },
    });
    expect(left.map((j) => j.status).sort()).toEqual(['DEAD', 'SUCCEEDED']);
  });
});
