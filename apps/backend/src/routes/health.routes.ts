import { Router } from 'express';
import { prisma } from '../config/prisma';
import { isSentryEnabled } from '../config/sentry';
import { mailer } from '../utils/mailer';
import { sendError, sendSuccess } from '../utils/apiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';

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

/**
 * OWNER-only readiness report for the optional integrations. Answers "is my
 * error tracking / email actually switched on in THIS deployment?" without
 * making the operator dig through startup logs, and without exposing the
 * platform's configuration to the public health probe above.
 *
 * Booleans only — never a DSN, host, user or key.
 */
router.get(
  '/integrations',
  authenticate,
  authorizeRoles('OWNER'),
  (_req, res) => {
    sendSuccess(
      res,
      {
        sentry: isSentryEnabled(),
        smtp: mailer.isConfigured(),
      },
      'Integration status retrieved successfully',
    );
  },
);

/**
 * Deliberately throw, to prove the error path end-to-end: central error
 * middleware → 500 response → Sentry issue. An initialisation log line only
 * proves the SDK started; it cannot prove an event reaches the dashboard, and an
 * alerting path nobody has ever fired is not an alerting path.
 *
 * OWNER-only, and it can do nothing but throw — no state is touched. The thrown
 * error is intentionally NON-operational so it matches exactly what the
 * middleware forwards to Sentry (operational AppErrors are not reported).
 */
router.post(
  '/test-error',
  authenticate,
  authorizeRoles('OWNER'),
  asyncHandler(async (req) => {
    throw new Error(
      `Sentry verification error triggered deliberately (requestId=${req.requestId})`,
    );
  }),
);

export const healthRoutes = router;
