import type { Request, Response } from 'express';
import { internalNotesService } from './internal-notes.service';
import { sendSuccess } from '../../utils/apiResponse';

export const internalNotesController = {
  async list(req: Request, res: Response): Promise<void> {
    const notes = await internalNotesService.list(
      req.user!.companyId,
      req.params.conversationId,
    );
    sendSuccess(res, { notes }, 'Notes retrieved successfully');
  },

  async create(req: Request, res: Response): Promise<void> {
    const note = await internalNotesService.create(
      req.user!.companyId,
      req.params.conversationId,
      req.user!.id,
      req.body.content,
    );
    sendSuccess(res, { note }, 'Note added successfully', 201);
  },

  async update(req: Request, res: Response): Promise<void> {
    const note = await internalNotesService.update(
      req.user!.companyId,
      req.params.conversationId,
      req.params.noteId,
      { id: req.user!.id, role: req.user!.role },
      req.body.content,
    );
    sendSuccess(res, { note }, 'Note updated successfully');
  },

  async remove(req: Request, res: Response): Promise<void> {
    await internalNotesService.remove(
      req.user!.companyId,
      req.params.conversationId,
      req.params.noteId,
      { id: req.user!.id, role: req.user!.role },
    );
    sendSuccess(res, null, 'Note deleted successfully');
  },
};
