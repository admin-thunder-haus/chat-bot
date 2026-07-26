import type { Request, Response } from 'express';
import { companiesService } from './companies.service';
import { companyExportService } from './company-export.service';
import { sendSuccess } from '../../utils/apiResponse';
import { clearRefreshCookie } from '../../utils/cookies';

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

  /**
   * GDPR data portability: the tenant's own data as a downloadable JSON file.
   * Sent as an attachment rather than an inline API payload — the point is for
   * the owner to KEEP the file, and a Content-Disposition means the browser
   * saves it with a sensible name instead of rendering a megabyte of JSON.
   */
  async exportData(req: Request, res: Response): Promise<void> {
    const companyId = req.user!.companyId;
    const company = await companiesService.getById(companyId);
    const data = await companyExportService.build(companyId);

    res
      .status(200)
      .type('application/json')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="${companyExportService.fileName(company.slug)}"`,
      );
    // Deliberately NOT sendSuccess: this is a file, not an API envelope, and
    // wrapping it would make the download awkward to re-import.
    res.send(JSON.stringify(data, null, 2));
  },

  async deleteCompany(req: Request, res: Response): Promise<void> {
    const result = await companiesService.deleteCompany(
      req.user!.companyId,
      req.body.confirmName,
    );
    // The caller's tokens now point at a company that no longer exists, so the
    // refresh cookie is cleared: leaving it set would give the browser a token
    // that can only ever produce confusing 401s.
    clearRefreshCookie(res);
    sendSuccess(
      res,
      result,
      'Your company and all of its data have been permanently deleted',
    );
  },
};
