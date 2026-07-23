import { request } from '../api';
import type { AIAnalytics } from '../types';

export type AnalyticsRange = 7 | 30 | 90;

export const analyticsApi = {
  ai(days: AnalyticsRange): Promise<AIAnalytics> {
    return request(`/analytics/ai?days=${days}`, { auth: true });
  },
};
