import type { Notification, NotificationType, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { toSkipTake } from '../../utils/pagination';

/**
 * Data-access for notifications. Every query is scoped by companyId, and reads
 * additionally by VISIBILITY: a row targets the whole company (userId null) or
 * exactly one user (userId set). A user only ever sees company-wide rows plus
 * their own.
 */
function visibleWhere(
  companyId: string,
  userId: string,
): Prisma.NotificationWhereInput {
  return { companyId, OR: [{ userId: null }, { userId }] };
}

export const notificationsRepository = {
  create(
    companyId: string,
    data: {
      userId?: string | null;
      type: NotificationType;
      title: string;
      body: string;
      data?: Prisma.InputJsonValue;
    },
  ): Promise<Notification> {
    return prisma.notification.create({
      data: {
        companyId,
        userId: data.userId ?? null,
        type: data.type,
        title: data.title,
        body: data.body,
        data: data.data,
      },
    });
  },

  async listVisible(
    companyId: string,
    userId: string,
    filters: { page: number; limit: number; unread?: boolean },
  ): Promise<{ items: Notification[]; total: number }> {
    const where: Prisma.NotificationWhereInput = visibleWhere(
      companyId,
      userId,
    );
    if (filters.unread) where.readAt = null;

    const { skip, take } = toSkipTake(filters.page, filters.limit);
    const [items, total] = await prisma.$transaction([
      prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      prisma.notification.count({ where }),
    ]);
    return { items, total };
  },

  countUnread(companyId: string, userId: string): Promise<number> {
    return prisma.notification.count({
      where: { ...visibleWhere(companyId, userId), readAt: null },
    });
  },

  /**
   * Mark one visible notification read (idempotent — already-read rows are
   * untouched). Returns the row, or null when it is unknown or another
   * tenant's/user's.
   */
  async markRead(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<Notification | null> {
    await prisma.notification.updateMany({
      where: { id, ...visibleWhere(companyId, userId), readAt: null },
      data: { readAt: new Date() },
    });
    return prisma.notification.findFirst({
      where: { id, ...visibleWhere(companyId, userId) },
    });
  },

  /** Mark every visible unread notification read; returns how many changed. */
  async markAllRead(companyId: string, userId: string): Promise<number> {
    const result = await prisma.notification.updateMany({
      where: { ...visibleWhere(companyId, userId), readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  },
};
