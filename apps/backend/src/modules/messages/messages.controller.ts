import type { Request, Response } from 'express';
import { messagesService } from './messages.service';
import { sendSuccess } from '../../utils/apiResponse';

export const messagesController = {
  async list(req: Request, res: Response): Promise<void> {
    const result = await messagesService.list(
      req.user!.companyId,
      req.params.conversationId,
      req.query as never,
    );
    sendSuccess(res, result, 'Messages retrieved successfully');
  },

  async send(req: Request, res: Response): Promise<void> {
    const message = await messagesService.send(
      req.user!.companyId,
      req.params.conversationId,
      req.user!.id,
      req.body,
    );
    sendSuccess(res, { message }, 'Message sent successfully', 201);
  },
};
