import { z } from 'zod';
import { booleanQuery } from '../../validations/common.validation';

export const notificationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** unread=true limits the list to unread notifications. */
  unread: booleanQuery,
});

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
