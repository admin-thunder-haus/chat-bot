import type { NotificationType, Prisma, UserRole } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import { mailer } from '../../utils/mailer';
import { paginate, type PaginatedResult } from '../../utils/pagination';
import { notificationsRepository } from './notifications.repository';
import {
  serializeNotification,
  type SerializedNotification,
} from './notifications.types';
import type { NotificationListQuery } from './notifications.validation';

export interface CreateFromEventInput {
  companyId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Users with one of these roles also receive the notification by email. */
  emailRoles?: UserRole[];
}

export const notificationsService = {
  /**
   * Domain-event consumer: persist an in-app notification (company-wide row —
   * userId null) and optionally email the company users whose role is in
   * `emailRoles`. Email failures are logged and never propagate (the mailer
   * itself already degrades to logging when SMTP is not configured).
   */
  async createFromEvent(input: CreateFromEventInput): Promise<void> {
    await notificationsRepository.create(input.companyId, {
      userId: null,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data as Prisma.InputJsonValue | undefined,
    });

    if (!input.emailRoles || input.emailRoles.length === 0) return;

    const recipients = await prisma.user.findMany({
      where: {
        companyId: input.companyId,
        status: 'ACTIVE',
        role: { in: input.emailRoles },
      },
      select: { email: true },
    });

    await Promise.all(
      recipients.map((user) =>
        mailer
          .sendEmail({ to: user.email, subject: input.title, text: input.body })
          .catch((err: unknown) => {
            logger.warn('notifications.email.failed', {
              companyId: input.companyId,
              type: input.type,
              message: err instanceof Error ? err.message : String(err),
            });
          }),
      ),
    );
  },

  async list(
    companyId: string,
    userId: string,
    query: NotificationListQuery,
  ): Promise<PaginatedResult<SerializedNotification>> {
    const { items, total } = await notificationsRepository.listVisible(
      companyId,
      userId,
      query,
    );
    return paginate(
      items.map(serializeNotification),
      total,
      query.page,
      query.limit,
    );
  },

  async unreadCount(
    companyId: string,
    userId: string,
  ): Promise<{ count: number }> {
    const count = await notificationsRepository.countUnread(companyId, userId);
    return { count };
  },

  async markRead(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<SerializedNotification> {
    const row = await notificationsRepository.markRead(companyId, userId, id);
    if (!row) throw AppError.notFound('Notification not found');
    return serializeNotification(row);
  },

  async markAllRead(
    companyId: string,
    userId: string,
  ): Promise<{ updated: number }> {
    const updated = await notificationsRepository.markAllRead(
      companyId,
      userId,
    );
    return { updated };
  },
};
