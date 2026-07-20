import type { UserRole } from './types';

/** OWNER and ADMIN may perform Day 2 write actions; AGENT is read-only. */
export function canWrite(role: UserRole | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}
