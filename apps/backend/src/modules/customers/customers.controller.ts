import type { Request, Response } from 'express';
import { customersService } from './customers.service';
import { conversationsService } from '../conversations/conversations.service';
import { sendSuccess } from '../../utils/apiResponse';

export const customersController = {
  async list(req: Request, res: Response): Promise<void> {
    const result = await customersService.list(
      req.user!.companyId,
      req.query as never,
    );
    sendSuccess(res, result, 'Customers retrieved successfully');
  },

  async getOne(req: Request, res: Response): Promise<void> {
    const customer = await customersService.getById(
      req.user!.companyId,
      req.params.customerId,
    );
    sendSuccess(res, { customer }, 'Customer retrieved successfully');
  },

  async create(req: Request, res: Response): Promise<void> {
    const customer = await customersService.create(
      req.user!.companyId,
      req.body,
    );
    sendSuccess(res, { customer }, 'Customer created successfully', 201);
  },

  async update(req: Request, res: Response): Promise<void> {
    const customer = await customersService.update(
      req.user!.companyId,
      req.params.customerId,
      req.body,
    );
    sendSuccess(res, { customer }, 'Customer updated successfully');
  },

  async listConversations(req: Request, res: Response): Promise<void> {
    // Ensure the customer belongs to the tenant (404 otherwise).
    await customersService.getById(req.user!.companyId, req.params.customerId);
    const result = await conversationsService.list(req.user!.companyId, {
      ...(req.query as Record<string, unknown>),
      customerId: req.params.customerId,
    } as never);
    sendSuccess(res, result, 'Customer conversations retrieved successfully');
  },
};
