import type { Request, Response } from 'express';
import { productsService } from './products.service';
import { sendSuccess } from '../../utils/apiResponse';

export const productsController = {
  async list(req: Request, res: Response): Promise<void> {
    const result = await productsService.list(
      req.user!.companyId,
      req.query as never,
    );
    sendSuccess(res, result, 'Products retrieved successfully');
  },

  async getOne(req: Request, res: Response): Promise<void> {
    const product = await productsService.getById(
      req.user!.companyId,
      req.params.productId,
    );
    sendSuccess(res, { product }, 'Product retrieved successfully');
  },

  async create(req: Request, res: Response): Promise<void> {
    const product = await productsService.create(
      req.user!.companyId,
      req.body,
    );
    sendSuccess(res, { product }, 'Product created successfully', 201);
  },

  async update(req: Request, res: Response): Promise<void> {
    const product = await productsService.update(
      req.user!.companyId,
      req.params.productId,
      req.body,
    );
    sendSuccess(res, { product }, 'Product updated successfully');
  },

  async setStatus(req: Request, res: Response): Promise<void> {
    const product = await productsService.setStatus(
      req.user!.companyId,
      req.params.productId,
      req.body.isActive,
    );
    sendSuccess(res, { product }, 'Product status updated successfully');
  },

  async remove(req: Request, res: Response): Promise<void> {
    await productsService.remove(req.user!.companyId, req.params.productId);
    sendSuccess(res, null, 'Product deleted successfully');
  },

  async reorder(req: Request, res: Response): Promise<void> {
    const products = await productsService.reorder(
      req.user!.companyId,
      req.body,
    );
    sendSuccess(res, { products }, 'Products reordered successfully');
  },

  async importPreview(req: Request, res: Response): Promise<void> {
    const preview = await productsService.importPreview(req.file!.buffer);
    sendSuccess(res, preview, 'Import preview generated successfully');
  },

  async importCommit(req: Request, res: Response): Promise<void> {
    const result = await productsService.importCommit(
      req.user!.companyId,
      req.file!.buffer,
      req.body.mode,
    );
    sendSuccess(res, result, 'Products imported successfully');
  },
};
