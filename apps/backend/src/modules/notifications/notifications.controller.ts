import type { Request, Response } from 'express';
import { notificationsService } from './notifications.service';
import { sendSuccess } from '../../utils/apiResponse';

export const notificationsController = {
  async list(req: Request, res: Response): Promise<void> {
    const result = await notificationsService.list(
      req.user!.companyId,
      req.user!.id,
      req.query as never,
    );
    sendSuccess(res, result, 'Notifications retrieved successfully');
  },

  async unreadCount(req: Request, res: Response): Promise<void> {
    const result = await notificationsService.unreadCount(
      req.user!.companyId,
      req.user!.id,
    );
    sendSuccess(res, result, 'Unread count retrieved successfully');
  },

  async markRead(req: Request, res: Response): Promise<void> {
    const notification = await notificationsService.markRead(
      req.user!.companyId,
      req.user!.id,
      req.params.notificationId,
    );
    sendSuccess(res, { notification }, 'Notification marked as read');
  },

  async markAllRead(req: Request, res: Response): Promise<void> {
    const result = await notificationsService.markAllRead(
      req.user!.companyId,
      req.user!.id,
    );
    sendSuccess(res, result, 'All notifications marked as read');
  },
};
