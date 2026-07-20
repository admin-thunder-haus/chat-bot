import type { Request, Response } from 'express';
import { aiSettingsService } from './ai-settings.service';
import { sendSuccess } from '../../utils/apiResponse';

export const aiSettingsController = {
  async get(req: Request, res: Response): Promise<void> {
    const settings = await aiSettingsService.get(req.user!.companyId);
    sendSuccess(res, { settings }, 'AI settings retrieved successfully');
  },

  async save(req: Request, res: Response): Promise<void> {
    const settings = await aiSettingsService.save(
      req.user!.companyId,
      req.body,
    );
    sendSuccess(res, { settings }, 'AI settings updated successfully');
  },
};
