import type { Request, Response } from 'express';
import type { DayOfWeek } from '@prisma/client';
import { businessHoursService } from './business-hours.service';
import { sendSuccess } from '../../utils/apiResponse';

export const businessHoursController = {
  async get(req: Request, res: Response): Promise<void> {
    const hours = await businessHoursService.getSchedule(req.user!.companyId);
    sendSuccess(res, { hours }, 'Business hours retrieved successfully');
  },

  async save(req: Request, res: Response): Promise<void> {
    const hours = await businessHoursService.saveSchedule(
      req.user!.companyId,
      req.body,
    );
    sendSuccess(res, { hours }, 'Business hours updated successfully');
  },

  async updateDay(req: Request, res: Response): Promise<void> {
    const day = await businessHoursService.updateDay(
      req.user!.companyId,
      req.params.dayOfWeek as DayOfWeek,
      req.body,
    );
    sendSuccess(res, { day }, 'Business hours updated successfully');
  },
};
