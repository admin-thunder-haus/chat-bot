import { z } from 'zod';
import { paginationQuerySchema } from '../../validations/common.validation';

/** GET /actions/executions — paginated, filterable audit log. */
export const executionListQuerySchema = paginationQuerySchema.extend({
  actionKey: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['completed', 'failed', 'rejected']).optional(),
});
export type ExecutionListQuery = z.infer<typeof executionListQuerySchema>;

export const appointmentListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED']).optional(),
});
export type AppointmentListQuery = z.infer<typeof appointmentListQuerySchema>;

export const appointmentStatusSchema = z
  .object({
    status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED']),
  })
  .strict();

export const orderListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['NEW', 'CONFIRMED', 'CANCELLED', 'FULFILLED']).optional(),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export const orderStatusSchema = z
  .object({
    status: z.enum(['NEW', 'CONFIRMED', 'CANCELLED', 'FULFILLED']),
  })
  .strict();

export const ticketListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
});
export type TicketListQuery = z.infer<typeof ticketListQuerySchema>;

export const ticketStatusSchema = z
  .object({
    status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
  })
  .strict();
