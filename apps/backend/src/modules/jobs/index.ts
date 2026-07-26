/**
 * Public surface of the background job queue.
 *
 * Importing this module also REGISTERS every handler (see ./handlers), so the
 * queue is usable the moment anything touches it. Feature modules enqueue via
 * `jobsService.enqueueSafely(...)` and never import a handler directly.
 */
export { jobsService, retryDelayMs, type RunJobsResult } from './jobs.service';
export {
  startJobsWorker,
  stopJobsWorker,
  runWorkerPass,
} from './jobs.worker';
export {
  registerJobHandler,
  getJobHandler,
  registeredJobTypes,
  clearJobHandlersForTesting,
} from './jobs.registry';
export {
  JOB_TYPES,
  PermanentJobError,
  type EnqueueOptions,
  type JobHandler,
  type JobPayload,
  type JobPayloads,
  type JobType,
} from './jobs.types';
export { jobsRepository } from './jobs.repository';

// Side-effect import: wires the handlers into the registry.
import './handlers';
