import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Assign a stable id to each request. Honours an inbound X-Request-Id (useful
 * behind a proxy/gateway) or generates a new UUID, and echoes it back in the
 * response header so clients can correlate logs and error responses.
 */
export function requestId(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && incoming.length > 0
      ? incoming
      : crypto.randomUUID();

  req.requestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}
