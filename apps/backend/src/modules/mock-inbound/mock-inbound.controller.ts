import type { Request, Response } from 'express';
import { mockInboundService } from './mock-inbound.service';
import { sendSuccess } from '../../utils/apiResponse';

export const mockInboundController = {
  async create(req: Request, res: Response): Promise<void> {
    const result = await mockInboundService.handle(
      req.user!.companyId,
      req.user!.id,
      req.body,
    );
    sendSuccess(
      res,
      result,
      result.idempotent
        ? 'Message already processed (idempotent)'
        : 'Mock inbound message processed successfully',
      result.idempotent ? 200 : 201,
    );
  },
};
