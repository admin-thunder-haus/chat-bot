import type { Request, Response } from 'express';
import { knowledgeBaseService } from './knowledge-base.service';
import { sendSuccess } from '../../utils/apiResponse';

export const knowledgeBaseController = {
  async list(req: Request, res: Response): Promise<void> {
    const result = await knowledgeBaseService.list(
      req.user!.companyId,
      req.query as never,
    );
    sendSuccess(res, result, 'Knowledge base retrieved successfully');
  },

  async getOne(req: Request, res: Response): Promise<void> {
    const entry = await knowledgeBaseService.getById(
      req.user!.companyId,
      req.params.entryId,
    );
    sendSuccess(res, { entry }, 'Knowledge base entry retrieved successfully');
  },

  async create(req: Request, res: Response): Promise<void> {
    const entry = await knowledgeBaseService.create(
      req.user!.companyId,
      req.body,
    );
    sendSuccess(res, { entry }, 'Knowledge base entry created successfully', 201);
  },

  async update(req: Request, res: Response): Promise<void> {
    const entry = await knowledgeBaseService.update(
      req.user!.companyId,
      req.params.entryId,
      req.body,
    );
    sendSuccess(res, { entry }, 'Knowledge base entry updated successfully');
  },

  async setStatus(req: Request, res: Response): Promise<void> {
    const entry = await knowledgeBaseService.setStatus(
      req.user!.companyId,
      req.params.entryId,
      req.body.isActive,
    );
    sendSuccess(res, { entry }, 'Knowledge base status updated successfully');
  },

  async remove(req: Request, res: Response): Promise<void> {
    await knowledgeBaseService.remove(
      req.user!.companyId,
      req.params.entryId,
    );
    sendSuccess(res, null, 'Knowledge base entry deleted successfully');
  },

  async reorder(req: Request, res: Response): Promise<void> {
    const entries = await knowledgeBaseService.reorder(
      req.user!.companyId,
      req.body,
    );
    sendSuccess(res, { entries }, 'Knowledge base reordered successfully');
  },
};
