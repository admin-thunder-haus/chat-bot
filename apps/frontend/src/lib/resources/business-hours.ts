import { request } from '../api';
import type { DayOfWeek, WeeklyDay } from '../types';

export const businessHoursApi = {
  get(): Promise<{ hours: WeeklyDay[] }> {
    return request('/business-hours', { auth: true });
  },
  save(hours: WeeklyDay[]): Promise<{ hours: WeeklyDay[] }> {
    return request('/business-hours', {
      method: 'PUT',
      body: { hours },
      auth: true,
    });
  },
  updateDay(
    dayOfWeek: DayOfWeek,
    input: { isClosed: boolean; openTime: string | null; closeTime: string | null },
  ): Promise<{ day: WeeklyDay }> {
    return request(`/business-hours/${dayOfWeek}`, {
      method: 'PATCH',
      body: input,
      auth: true,
    });
  },
};
