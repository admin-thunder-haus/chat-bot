import type { Request, Response } from 'express';
import { aiService } from './ai.service';
import { aiUsageService } from './ai-usage.service';
import { sendSuccess } from '../../utils/apiResponse';

export const aiController = {
  async draft(req: Request, res: Response): Promise<void> {
    const result = await aiService.generateDraft(
      req.user!.companyId,
      req.params.conversationId,
      req.user!.id,
      req.body.instruction,
    );
    sendSuccess(res, result, 'AI draft generated successfully');
  },

  async regenerate(req: Request, res: Response): Promise<void> {
    const result = await aiService.regenerate(
      req.user!.companyId,
      req.params.conversationId,
      req.user!.id,
      req.body.adjustment,
    );
    sendSuccess(res, result, 'AI draft regenerated successfully');
  },

  async reply(req: Request, res: Response): Promise<void> {
    const { result, message } = await aiService.replyAndSend(
      req.user!.companyId,
      req.params.conversationId,
      req.user!.id,
    );
    sendSuccess(res, { result, message }, 'AI reply sent successfully', 201);
  },

  async setMode(req: Request, res: Response): Promise<void> {
    const conversation = await aiService.setMode(
      req.user!.companyId,
      req.params.conversationId,
      { id: req.user!.id, role: req.user!.role },
      req.body.mode,
    );
    sendSuccess(res, { conversation }, 'AI mode updated successfully');
  },

  async usage(req: Request, res: Response): Promise<void> {
    const usage = await aiUsageService.getSummary(req.user!.companyId);
    sendSuccess(res, usage, 'AI usage retrieved successfully');
  },

  async listGenerations(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as {
      page: number;
      limit: number;
      conversationId?: string;
    };
    const result = await aiService.listGenerations(
      req.user!.companyId,
      query.page,
      query.limit,
      query.conversationId,
    );
    sendSuccess(res, result, 'AI generations retrieved successfully');
  },

  async getGeneration(req: Request, res: Response): Promise<void> {
    const generation = await aiService.getGeneration(
      req.user!.companyId,
      req.params.generationId,
    );
    sendSuccess(res, { generation }, 'AI generation retrieved successfully');
  },

  async playground(req: Request, res: Response): Promise<void> {
    const result = await aiService.playground(
      req.user!.companyId,
      req.user!.id,
      req.body,
    );
    sendSuccess(res, result, 'AI playground result generated successfully');
  },
};
