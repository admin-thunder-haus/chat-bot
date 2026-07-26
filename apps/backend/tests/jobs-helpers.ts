import { jobsService } from '../src/modules/jobs/jobs.service';
import { prisma } from './setup';

/**
 * Run every queued background job to completion, then assert none failed.
 *
 * Uploads and inbound webhooks now RETURN BEFORE their heavy work runs (PDF
 * extraction, media download, transcription, AI auto-reply), so a test that
 * asserts the outcome must first let the queue catch up. This is deterministic —
 * it drives the worker directly and never sleeps.
 *
 * The dead-letter check is the valuable part: without it a handler that started
 * throwing would silently turn "the reply was generated" into "nothing
 * happened, and the assertion below is what tells you", which is a much harder
 * failure to read.
 */
export async function drainJobs(): Promise<void> {
  await jobsService.drainJobs();

  const dead = await prisma.job.findMany({
    where: { status: 'DEAD' },
    select: { type: true, lastError: true },
  });
  if (dead.length > 0) {
    throw new Error(
      `background job(s) dead-lettered during the test:\n${dead
        .map((j) => `  ${j.type}: ${j.lastError}`)
        .join('\n')}`,
    );
  }
}
