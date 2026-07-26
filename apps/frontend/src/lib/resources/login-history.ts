import { request } from '../api';
import type { LoginHistoryEntry } from '../types';

/**
 * The signed-in user's own recent sign-in attempts. There is no id parameter by
 * design — the backend derives the subject from the access token, so this client
 * has nothing it could point at someone else's account.
 */
export const loginHistoryApi = {
  list(): Promise<{ events: LoginHistoryEntry[]; limit: number }> {
    return request('/auth/login-history', { auth: true });
  },
};
