import type { Request, Response } from 'express';
import { conversationsService } from './conversations.service';
import { assignmentsService } from '../assignments/assignments.service';
import { sendSuccess } from '../../utils/apiResponse';

export const conversationsController = {
  async list(req: Request, res: Response): Promise<void> {
    const result = await conversationsService.list(
      req.user!.companyId,
      req.query as never,
    );
    sendSuccess(res, result, 'Conversations retrieved successfully');
  },

  async getOne(req: Request, res: Response): Promise<void> {
    const conversation = await conversationsService.getDetail(
      req.user!.companyId,
      req.params.conversationId,
    );
    sendSuccess(res, { conversation }, 'Conversation retrieved successfully');
  },

  async create(req: Request, res: Response): Promise<void> {
    const conversation = await conversationsService.create(
      req.user!.companyId,
      req.user!.id,
      req.body,
    );
    sendSuccess(res, { conversation }, 'Conversation created successfully', 201);
  },

  async update(req: Request, res: Response): Promise<void> {
    const conversation = await conversationsService.updateSubject(
      req.user!.companyId,
      req.params.conversationId,
      req.body,
    );
    sendSuccess(res, { conversation }, 'Conversation updated successfully');
  },

  async setStatus(req: Request, res: Response): Promise<void> {
    const conversation = await conversationsService.setStatus(
      req.user!.companyId,
      req.params.conversationId,
      req.user!.id,
      req.body.status,
    );
    sendSuccess(res, { conversation }, 'Conversation status updated successfully');
  },

  async setPriority(req: Request, res: Response): Promise<void> {
    const conversation = await conversationsService.setPriority(
      req.user!.companyId,
      req.params.conversationId,
      req.user!.id,
      req.body.priority,
    );
    sendSuccess(res, { conversation }, 'Conversation priority updated successfully');
  },

  async setAssignment(req: Request, res: Response): Promise<void> {
    const conversation = await assignmentsService.setAssignment(
      req.user!.companyId,
      req.params.conversationId,
      { id: req.user!.id, role: req.user!.role },
      req.body.assignedUserId,
    );
    sendSuccess(res, { conversation }, 'Conversation assignment updated successfully');
  },

  async setArchived(req: Request, res: Response): Promise<void> {
    const conversation = await conversationsService.setArchived(
      req.user!.companyId,
      req.params.conversationId,
      req.body.isArchived,
    );
    sendSuccess(res, { conversation }, 'Conversation archive state updated successfully');
  },

  async markRead(req: Request, res: Response): Promise<void> {
    const conversation = await conversationsService.markRead(
      req.user!.companyId,
      req.params.conversationId,
    );
    sendSuccess(res, { conversation }, 'Conversation marked as read');
  },

  async activity(req: Request, res: Response): Promise<void> {
    const activities = await conversationsService.listActivity(
      req.user!.companyId,
      req.params.conversationId,
    );
    sendSuccess(res, { activities }, 'Conversation activity retrieved successfully');
  },
};
