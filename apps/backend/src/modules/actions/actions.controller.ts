import type { Request, Response } from 'express';
import type {
  AppointmentStatus,
  OrderStatus,
  TicketStatus,
} from '@prisma/client';
import { sendSuccess } from '../../utils/apiResponse';
import { actionsService } from './actions.service';
import type {
  AppointmentListQuery,
  ExecutionListQuery,
  OrderListQuery,
  TicketListQuery,
} from './actions.validation';

export const actionsController = {
  async listExecutions(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as ExecutionListQuery;
    const result = await actionsService.listExecutions(
      req.user!.companyId,
      query,
    );
    sendSuccess(res, result, 'Action executions retrieved successfully');
  },

  async listAppointments(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as AppointmentListQuery;
    const result = await actionsService.listAppointments(
      req.user!.companyId,
      query,
    );
    sendSuccess(res, result, 'Appointments retrieved successfully');
  },

  async setAppointmentStatus(req: Request, res: Response): Promise<void> {
    const appointment = await actionsService.setAppointmentStatus(
      req.user!.companyId,
      req.params.appointmentId,
      req.body.status as AppointmentStatus,
    );
    sendSuccess(res, { appointment }, 'Appointment status updated');
  },

  async listOrders(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as OrderListQuery;
    const result = await actionsService.listOrders(req.user!.companyId, query);
    sendSuccess(res, result, 'Orders retrieved successfully');
  },

  async setOrderStatus(req: Request, res: Response): Promise<void> {
    const order = await actionsService.setOrderStatus(
      req.user!.companyId,
      req.params.orderId,
      req.body.status as OrderStatus,
    );
    sendSuccess(res, { order }, 'Order status updated');
  },

  async listTickets(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as TicketListQuery;
    const result = await actionsService.listTickets(req.user!.companyId, query);
    sendSuccess(res, result, 'Tickets retrieved successfully');
  },

  async setTicketStatus(req: Request, res: Response): Promise<void> {
    const ticket = await actionsService.setTicketStatus(
      req.user!.companyId,
      req.params.ticketId,
      req.body.status as TicketStatus,
    );
    sendSuccess(res, { ticket }, 'Ticket status updated');
  },
};
