import type { Request, Response } from 'express';
import { faqsService } from './faqs.service';
import { sendSuccess } from '../../utils/apiResponse';

export const faqsController = {
  async list(req: Request, res: Response): Promise<void> {
    const result = await faqsService.list(
      req.user!.companyId,
      req.query as never,
    );
    sendSuccess(res, result, 'FAQs retrieved successfully');
  },

  async getOne(req: Request, res: Response): Promise<void> {
    const faq = await faqsService.getById(
      req.user!.companyId,
      req.params.faqId,
    );
    sendSuccess(res, { faq }, 'FAQ retrieved successfully');
  },

  async create(req: Request, res: Response): Promise<void> {
    const faq = await faqsService.create(req.user!.companyId, req.body);
    sendSuccess(res, { faq }, 'FAQ created successfully', 201);
  },

  async update(req: Request, res: Response): Promise<void> {
    const faq = await faqsService.update(
      req.user!.companyId,
      req.params.faqId,
      req.body,
    );
    sendSuccess(res, { faq }, 'FAQ updated successfully');
  },

  async setStatus(req: Request, res: Response): Promise<void> {
    const faq = await faqsService.setStatus(
      req.user!.companyId,
      req.params.faqId,
      req.body.isActive,
    );
    sendSuccess(res, { faq }, 'FAQ status updated successfully');
  },

  async remove(req: Request, res: Response): Promise<void> {
    await faqsService.remove(req.user!.companyId, req.params.faqId);
    sendSuccess(res, null, 'FAQ deleted successfully');
  },

  async reorder(req: Request, res: Response): Promise<void> {
    const faqs = await faqsService.reorder(req.user!.companyId, req.body);
    sendSuccess(res, { faqs }, 'FAQs reordered successfully');
  },
};
