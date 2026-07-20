import { request } from '../api';
import type { UserSummary } from '../types';

export const usersApi = {
  assignable(): Promise<{ users: UserSummary[] }> {
    return request('/users/assignable', { auth: true });
  },
};
