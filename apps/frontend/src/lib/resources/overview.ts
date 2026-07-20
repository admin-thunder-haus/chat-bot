import { request } from '../api';
import type { OverviewStats } from '../types';

export const overviewApi = {
  get(): Promise<OverviewStats> {
    return request('/overview', { auth: true });
  },
};
