import type { JobHandler, JobType } from './jobs.types';

/**
 * Handler registry, mirroring the channel provider registry: each feature
 * module registers its own handler at import time, so the queue core never
 * imports a feature and cannot become a dependency hub.
 */
const handlers = new Map<JobType, JobHandler>();

export function registerJobHandler<T extends JobType>(
  type: T,
  handler: JobHandler<T>,
): void {
  // Registration happens at module load; a duplicate means two modules both
  // claim a type, which would silently drop one. Fail loudly at boot instead.
  if (handlers.has(type)) {
    throw new Error(`A handler for job type "${type}" is already registered`);
  }
  handlers.set(type, handler as JobHandler);
}

export function getJobHandler(type: string): JobHandler | undefined {
  return handlers.get(type as JobType);
}

export function registeredJobTypes(): JobType[] {
  return [...handlers.keys()];
}

/** Test-only: drop registrations so a suite can install a fake handler. */
export function clearJobHandlersForTesting(): void {
  handlers.clear();
}
