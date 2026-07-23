import type { Request, Response } from 'express';
import { analyticsService } from './analytics.service';
import { sendSuccess } from '../../utils/apiResponse';

export const analyticsController = {
  async ai(req: Request, res: Response): Promise<void> {
    const { days } = req.query as unknown as { days: number };
    const analytics = await analyticsService.getAIAnalytics(
      req.user!.companyId,
      days,
    );
    sendSuccess(res, analytics, 'AI analytics retrieved successfully');
  },
};
