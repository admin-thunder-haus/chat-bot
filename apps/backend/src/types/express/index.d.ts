import type { UserRole } from '@prisma/client';

/**
 * The authenticated identity attached by the auth middleware.
 * companyId always comes from the verified JWT — never from client input —
 * so every downstream query can safely scope by req.user.companyId.
 */
export interface AuthenticatedUser {
  id: string;
  companyId: string;
  role: UserRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      requestId: string;
      // Raw request body bytes, captured by the JSON body-parser's `verify`
      // hook. Used by the webhook engine for signature verification.
      rawBody?: Buffer;
    }
  }
}

export {};
