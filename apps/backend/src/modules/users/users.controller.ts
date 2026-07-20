import type { Request, Response } from 'express';
import { usersService } from './users.service';
import { sendSuccess } from '../../utils/apiResponse';

export const usersController = {
  async assignable(req: Request, res: Response): Promise<void> {
    const users = await usersService.listAssignable(req.user!.companyId);
    sendSuccess(res, { users }, 'Assignable users retrieved successfully');
  },
};
