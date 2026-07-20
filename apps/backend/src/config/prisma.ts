import { PrismaClient } from '@prisma/client';
import { isProduction } from './env';

/**
 * Single shared PrismaClient instance.
 * In dev, tsx watch can reload modules; we cache the client on `globalThis`
 * to avoid exhausting the connection pool with duplicate clients.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction ? ['error'] : ['error', 'warn'],
  });

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}
