import type { Server } from 'node:http';
import { createApp } from './app';
import { env, isBillingEnabled } from './config/env';
import { prisma } from './config/prisma';
import { initSentry } from './config/sentry';
import { ensureDefaultPlans } from './modules/billing/billing.plans';
import {
  startChannelRetryScheduler,
  stopChannelRetryScheduler,
} from './modules/channels/channel-retry.scheduler';
import { startJobsWorker, stopJobsWorker } from './modules/jobs';
import { logger } from './utils/logger';

async function bootstrap(): Promise<void> {
  // Error tracking first, before the app exists, so a failure while wiring
  // routes is still reported. A no-op (and no SDK load at all) without a DSN.
  await initSentry();

  // Fail fast if the database is unreachable at startup.
  try {
    await prisma.$connect();
    logger.info('Connected to database');
  } catch (err) {
    logger.error('Failed to connect to database', {
      message: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }

  // Seed the default billing plan catalog (idempotent upsert by plan code).
  // Skipped entirely while billing is disabled — the platform must not write
  // billing rows it will never use. Non-fatal otherwise: the catalog is also
  // ensured lazily when a subscription is first needed.
  if (isBillingEnabled()) {
    try {
      await ensureDefaultPlans();
      logger.info('Default billing plans ensured');
    } catch (err) {
      logger.warn('Failed to ensure default billing plans', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    logger.info('Billing is disabled (BILLING_ENABLED is not "true")');
  }

  const app = createApp();
  const server: Server = app.listen(env.BACKEND_PORT, () => {
    logger.info(`Backend listening on port ${env.BACKEND_PORT}`, {
      env: env.NODE_ENV,
    });
  });

  // Started only once the server is listening: both loops write to the same
  // database as the request path, so they must not compete with startup work.
  startChannelRetryScheduler();
  startJobsWorker();

  setupGracefulShutdown(server);
}

/** Drain connections and disconnect Prisma on SIGINT/SIGTERM. */
function setupGracefulShutdown(server: Server): void {
  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully`);

    // Stop the background loops before draining so no new delivery attempt or
    // job starts while connections close and Prisma disconnects. An in-flight
    // job is left to finish; if the process dies first the job returns to
    // QUEUED and is picked up after the restart.
    stopChannelRetryScheduler();
    stopJobsWorker();

    server.close(async () => {
      try {
        await prisma.$disconnect();
        logger.info('Cleanup complete, exiting');
        process.exit(0);
      } catch (err) {
        logger.error('Error during shutdown', {
          message: err instanceof Error ? err.message : String(err),
        });
        process.exit(1);
      }
    });

    // Force-exit if graceful shutdown stalls.
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void bootstrap();
