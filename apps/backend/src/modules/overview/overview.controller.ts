import type { Request, Response } from 'express';
import { overviewService } from './overview.service';
import { sendSuccess } from '../../utils/apiResponse';

export const overviewController = {
  async get(req: Request, res: Response): Promise<void> {
    const stats = await overviewService.getStats(req.user!.companyId);
    sendSuccess(res, stats, 'Overview retrieved successfully');
  },
};
