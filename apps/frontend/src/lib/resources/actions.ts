import { request } from '../api';
import { toQuery } from './query';
import type {
  ActionExecutionStatus,
  AIActionExecution,
  Appointment,
  AppointmentStatus,
  Order,
  OrderStatus,
  Paginated,
  SupportTicket,
  TicketStatus,
} from '../types';

export interface ExecutionListParams {
  page?: number;
  limit?: number;
  actionKey?: string;
  status?: ActionExecutionStatus;
}

export interface OperationsListParams {
  page?: number;
  limit?: number;
  status?: string;
}

/** Operations surface for AI-created business records (Day 12 actions). */
export const actionsApi = {
  executions(
    params: ExecutionListParams = {},
  ): Promise<Paginated<AIActionExecution>> {
    return request(`/actions/executions${toQuery(params)}`, { auth: true });
  },

  appointments(
    params: OperationsListParams = {},
  ): Promise<Paginated<Appointment>> {
    return request(`/actions/appointments${toQuery(params)}`, { auth: true });
  },
  setAppointmentStatus(
    id: string,
    status: AppointmentStatus,
  ): Promise<{ appointment: Appointment }> {
    return request(`/actions/appointments/${id}/status`, {
      method: 'PATCH',
      body: { status },
      auth: true,
    });
  },

  orders(params: OperationsListParams = {}): Promise<Paginated<Order>> {
    return request(`/actions/orders${toQuery(params)}`, { auth: true });
  },
  setOrderStatus(id: string, status: OrderStatus): Promise<{ order: Order }> {
    return request(`/actions/orders/${id}/status`, {
      method: 'PATCH',
      body: { status },
      auth: true,
    });
  },

  tickets(
    params: OperationsListParams = {},
  ): Promise<Paginated<SupportTicket>> {
    return request(`/actions/tickets${toQuery(params)}`, { auth: true });
  },
  setTicketStatus(
    id: string,
    status: TicketStatus,
  ): Promise<{ ticket: SupportTicket }> {
    return request(`/actions/tickets/${id}/status`, {
      method: 'PATCH',
      body: { status },
      auth: true,
    });
  },
};
