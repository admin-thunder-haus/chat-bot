import type { Server } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './config/prisma';
import { logger } from './utils/logger';

async function bootstrap(): Promise<void> {
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

  const app = createApp();
  const server: Server = app.listen(env.BACKEND_PORT, () => {
    logger.info(`Backend listening on port ${env.BACKEND_PORT}`, {
      env: env.NODE_ENV,
    });
  });

  setupGracefulShutdown(server);
}

/** Drain connections and disconnect Prisma on SIGINT/SIGTERM. */
function setupGracefulShutdown(server: Server): void {
  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully`);

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
