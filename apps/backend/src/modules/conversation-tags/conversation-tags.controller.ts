import type { Request, Response } from 'express';
import { conversationTagsService } from './conversation-tags.service';
import { sendSuccess } from '../../utils/apiResponse';

export const conversationTagsController = {
  async list(req: Request, res: Response): Promise<void> {
    const tags = await conversationTagsService.list(req.user!.companyId);
    sendSuccess(res, { tags }, 'Tags retrieved successfully');
  },

  async create(req: Request, res: Response): Promise<void> {
    const tag = await conversationTagsService.create(
      req.user!.companyId,
      req.body,
    );
    sendSuccess(res, { tag }, 'Tag created successfully', 201);
  },

  async update(req: Request, res: Response): Promise<void> {
    const tag = await conversationTagsService.update(
      req.user!.companyId,
      req.params.tagId,
      req.body,
    );
    sendSuccess(res, { tag }, 'Tag updated successfully');
  },

  async remove(req: Request, res: Response): Promise<void> {
    await conversationTagsService.remove(req.user!.companyId, req.params.tagId);
    sendSuccess(res, null, 'Tag deleted successfully');
  },

  // Attach/detach are mounted under /conversations/:conversationId/tags/:tagId.
  async attach(req: Request, res: Response): Promise<void> {
    const tags = await conversationTagsService.attach(
      req.user!.companyId,
      req.params.conversationId,
      req.params.tagId,
      req.user!.id,
    );
    sendSuccess(res, { tags }, 'Tag added to conversation successfully');
  },

  async detach(req: Request, res: Response): Promise<void> {
    const tags = await conversationTagsService.detach(
      req.user!.companyId,
      req.params.conversationId,
      req.params.tagId,
      req.user!.id,
    );
    sendSuccess(res, { tags }, 'Tag removed from conversation successfully');
  },
};
