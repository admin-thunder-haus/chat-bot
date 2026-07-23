import type { Notification } from '@prisma/client';

export interface SerializedNotification {
  id: string;
  userId: string | null;
  type: Notification['type'];
  title: string;
  body: string;
  data: unknown;
  readAt: Date | null;
  createdAt: Date;
}

export function serializeNotification(n: Notification): SerializedNotification {
  return {
    id: n.id,
    userId: n.userId,
    type: n.type,
    title: n.title,
    body: n.body,
    data: n.data ?? null,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}
