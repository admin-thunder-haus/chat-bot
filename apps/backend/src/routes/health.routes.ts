import { Router } from 'express';
import { prisma } from '../config/prisma';
import { sendError, sendSuccess } from '../utils/apiResponse';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

/**
 * API health check (mounted at /api/v1/health).
 * Verifies database connectivity in addition to process liveness.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      sendSuccess(
        res,
        { status: 'ok', database: 'up', uptime: process.uptime() },
        'Service and database are healthy',
      );
    } catch {
      sendError(res, 'Database is not reachable', 503, [], req.requestId);
    }
  }),
);

export const healthRoutes = router;
