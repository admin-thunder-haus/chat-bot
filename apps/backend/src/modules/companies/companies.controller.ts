import type { Request, Response } from 'express';
import { companiesService } from './companies.service';
import { sendSuccess } from '../../utils/apiResponse';

export const companiesController = {
  async getProfile(req: Request, res: Response): Promise<void> {
    const company = await companiesService.getProfile(req.user!.companyId);
    sendSuccess(res, { company }, 'Company profile retrieved successfully');
  },

  async updateProfile(req: Request, res: Response): Promise<void> {
    const company = await companiesService.updateProfile(
      req.user!.companyId,
      req.body,
    );
    sendSuccess(res, { company }, 'Company profile updated successfully');
  },
};
