import bcrypt from 'bcrypt';
import { env } from '../config/env';

/** Hash a plaintext password using bcrypt with the configured cost factor. */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_SALT_ROUNDS);
}

/** Compare a plaintext password against a stored bcrypt hash. */
export function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
