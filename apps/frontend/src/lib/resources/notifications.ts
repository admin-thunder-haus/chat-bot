import { request } from '../api';
import { toQuery } from './query';
import type { AppNotification, Paginated } from '../types';

export interface NotificationListParams {
  page?: number;
  limit?: number;
  unread?: boolean;
}

export const notificationsApi = {
  list(
    params: NotificationListParams = {},
  ): Promise<Paginated<AppNotification>> {
    return request(`/notifications${toQuery(params)}`, { auth: true });
  },
  unreadCount(): Promise<{ count: number }> {
    return request('/notifications/unread-count', { auth: true });
  },
  markRead(id: string): Promise<{ notification: AppNotification }> {
    return request(`/notifications/${id}/read`, {
      method: 'PATCH',
      body: {},
      auth: true,
    });
  },
  markAllRead(): Promise<{ updated: number }> {
    return request('/notifications/read-all', {
      method: 'POST',
      body: {},
      auth: true,
    });
  },
};
