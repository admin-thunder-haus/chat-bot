import type { Request, Response } from 'express';
import { servicesService } from './services.service';
import { sendSuccess } from '../../utils/apiResponse';

export const servicesController = {
  async list(req: Request, res: Response): Promise<void> {
    const result = await servicesService.list(
      req.user!.companyId,
      req.query as never,
    );
    sendSuccess(res, result, 'Services retrieved successfully');
  },

  async getOne(req: Request, res: Response): Promise<void> {
    const service = await servicesService.getById(
      req.user!.companyId,
      req.params.serviceId,
    );
    sendSuccess(res, { service }, 'Service retrieved successfully');
  },

  async create(req: Request, res: Response): Promise<void> {
    const service = await servicesService.create(
      req.user!.companyId,
      req.body,
    );
    sendSuccess(res, { service }, 'Service created successfully', 201);
  },

  async update(req: Request, res: Response): Promise<void> {
    const service = await servicesService.update(
      req.user!.companyId,
      req.params.serviceId,
      req.body,
    );
    sendSuccess(res, { service }, 'Service updated successfully');
  },

  async setStatus(req: Request, res: Response): Promise<void> {
    const service = await servicesService.setStatus(
      req.user!.companyId,
      req.params.serviceId,
      req.body.isActive,
    );
    sendSuccess(res, { service }, 'Service status updated successfully');
  },

  async remove(req: Request, res: Response): Promise<void> {
    await servicesService.remove(req.user!.companyId, req.params.serviceId);
    sendSuccess(res, null, 'Service deleted successfully');
  },

  async reorder(req: Request, res: Response): Promise<void> {
    const services = await servicesService.reorder(
      req.user!.companyId,
      req.body,
    );
    sendSuccess(res, { services }, 'Services reordered successfully');
  },

  async importPreview(req: Request, res: Response): Promise<void> {
    const preview = await servicesService.importPreview(req.file!.buffer);
    sendSuccess(res, preview, 'Import preview generated successfully');
  },

  async importCommit(req: Request, res: Response): Promise<void> {
    const result = await servicesService.importCommit(
      req.user!.companyId,
      req.file!.buffer,
      req.body.mode,
    );
    sendSuccess(res, result, 'Services imported successfully');
  },
};
