import type { Company, User } from '@prisma/client';

/** User shape returned to clients — never includes passwordHash. */
export type PublicUser = Omit<User, 'passwordHash'>;

/** Company shape returned to clients. */
export type PublicCompany = Company;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** Result of register/login before tokens are split into cookie vs body. */
export interface AuthResult {
  user: PublicUser;
  company: PublicCompany;
  tokens: AuthTokens;
}
