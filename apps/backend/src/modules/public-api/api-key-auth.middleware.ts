import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import { hashToken } from '../../utils/jwt';
import { logger } from '../../utils/logger';
import { publicApiRepository } from './public-api.repository';

/** Identity attached to public-API requests authenticated with an API key. */
export interface ApiKeyIdentity {
  id: string;
  companyId: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey?: ApiKeyIdentity;
    }
  }
}

/** Don't write lastUsedAt on every request — once a minute is plenty. */
const LAST_USED_STAMP_INTERVAL_MS = 60_000;

/**
 * Public-API authentication: `Authorization: Bearer ak_live_…`. The key is
 * looked up by its SHA-256 hash (the plaintext is never stored), revoked keys
 * are rejected, and the tenant is derived from the key — never from input.
 */
export const authenticateApiKey = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw AppError.unauthorized('Missing or malformed Authorization header');
    }

    const key = header.slice('Bearer '.length).trim();
    if (!key.startsWith('ak_live_')) {
      throw AppError.unauthorized('Invalid API key');
    }

    const record = await publicApiRepository.findApiKeyByHash(hashToken(key));
    if (!record || record.revokedAt) {
      throw AppError.unauthorized('Invalid API key');
    }

    req.apiKey = {
      id: record.id,
      companyId: record.companyId,
      name: record.name,
      keyPrefix: record.keyPrefix,
      scopes: record.scopes,
    };

    // Throttled usage stamp; a failed stamp never fails the request.
    const lastUsed = record.lastUsedAt?.getTime() ?? 0;
    if (Date.now() - lastUsed > LAST_USED_STAMP_INTERVAL_MS) {
      try {
        await publicApiRepository.touchApiKey(record.id);
      } catch (err) {
        logger.warn('publicApi.lastUsedStamp.failed', {
          apiKeyId: record.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    next();
  },
);

/** Scope guard. Use after `authenticateApiKey`. */
export function requireScope(scope: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.apiKey) {
      throw AppError.unauthorized();
    }
    if (!req.apiKey.scopes.includes(scope)) {
      throw AppError.forbidden(
        `This API key does not have the "${scope}" scope`,
      );
    }
    next();
  };
}
