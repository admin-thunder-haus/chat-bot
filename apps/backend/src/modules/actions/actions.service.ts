import type {
  AppointmentStatus,
  OrderStatus,
  Prisma,
  TicketStatus,
} from '@prisma/client';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import { paginate } from '../../utils/pagination';
import { emitDomainEvent } from '../events/domain-events.service';
import { notificationsService } from '../notifications/notifications.service';
import { actionRegistry } from './action-registry';
import { actionsRepository } from './actions.repository';

/** The model's parsed ACTION_REQUEST payload. */
export interface ActionRequestPayload {
  action: string;
  input: Record<string, unknown>;
}

/** Outcome relayed back to the AI layer, which turns it into a customer reply. */
export interface ActionExecutionOutcome {
  status: 'completed' | 'failed' | 'rejected';
  actionKey: string;
  /** Ready-to-send customer text (confirmation / apology / clarification). */
  replyText: string;
  /** Handler summary (completed executions only). */
  summary: string | null;
  /** True for read-only lookups whose summary should feed a follow-up generation. */
  readOnly: boolean;
  executionId: string | null;
}

/** Dashboard notification titles for the write actions. */
const WRITE_ACTION_TITLES: Record<string, string> = {
  book_appointment: 'AI booked an appointment',
  create_order: 'AI created an order',
  create_support_ticket: 'AI created a support ticket',
};

/** Human-readable "field — problem" lines from zod issues (no internals leaked). */
function describeIssues(error: {
  issues: { path: (string | number)[]; message: string }[];
}): string[] {
  return error.issues.map((issue) => {
    const field = issue.path.join('.') || 'input';
    return `${field} — ${issue.message}`;
  });
}

export const actionsService = {
  /**
   * Validate + execute one AI-requested action for a conversation. NEVER
   * throws for action-level problems: invalid input is recorded as 'rejected'
   * (with a clarifying customer message built from the zod issues — no second
   * AI call), a handler error as 'failed' (with an apology), and success as
   * 'completed' (audit row + `action.executed` domain event + a SYSTEM_ALERT
   * notification for write actions).
   */
  async executeForConversation(params: {
    companyId: string;
    conversationId: string;
    customerId: string;
    generationId: string | null;
    request: ActionRequestPayload;
  }): Promise<ActionExecutionOutcome> {
    const { companyId, conversationId, customerId, generationId, request } =
      params;
    const inputJson = (request.input ?? {}) as Prisma.InputJsonValue;

    const handler = actionRegistry.get(request.action);
    if (!handler) {
      const execution = await actionsRepository.createExecution(companyId, {
        conversationId,
        generationId,
        actionKey: request.action,
        input: inputJson,
        status: 'rejected',
        errorMessage: `Unknown action "${request.action}"`,
      });
      return {
        status: 'rejected',
        actionKey: request.action,
        replyText:
          "I'm sorry, I can't do that for you directly. Is there anything else I can help you with?",
        summary: null,
        readOnly: false,
        executionId: execution.id,
      };
    }

    const parsed = handler.inputSchema.safeParse(request.input ?? {});
    if (!parsed.success) {
      const details = describeIssues(parsed.error);
      const execution = await actionsRepository.createExecution(companyId, {
        conversationId,
        generationId,
        actionKey: handler.key,
        input: inputJson,
        status: 'rejected',
        errorMessage: details.join('; '),
      });
      return {
        status: 'rejected',
        actionKey: handler.key,
        replyText: `I'd be happy to help with that, but I still need a few details first: ${details.join('; ')}. Could you share ${details.length > 1 ? 'them' : 'that'} with me?`,
        summary: null,
        readOnly: handler.readOnly ?? false,
        executionId: execution.id,
      };
    }

    try {
      const result = await handler.execute(
        { companyId, conversationId, customerId },
        parsed.data as Record<string, unknown>,
      );

      const execution = await actionsRepository.createExecution(companyId, {
        conversationId,
        generationId,
        actionKey: handler.key,
        input: parsed.data as Prisma.InputJsonValue,
        result: {
          summary: result.summary,
          ...(result.data ?? {}),
        } as Prisma.InputJsonValue,
        status: 'completed',
      });

      // Webhook-only domain event (the NotificationType enum has no ACTION
      // type, so in-app notification is handled separately below).
      await emitDomainEvent({
        companyId,
        type: 'action.executed',
        title: `AI action executed: ${handler.key}`,
        body: result.summary,
        data: {
          actionKey: handler.key,
          executionId: execution.id,
          conversationId,
          ...(result.data ?? {}),
        },
      });

      // Write actions surface in the dashboard bell as SYSTEM_ALERT; read-only
      // lookups stay silent. A notification failure never fails the action.
      if (!handler.readOnly) {
        try {
          await notificationsService.createFromEvent({
            companyId,
            type: 'SYSTEM_ALERT',
            title:
              WRITE_ACTION_TITLES[handler.key] ??
              `AI performed action: ${handler.key}`,
            body: result.summary,
            data: {
              actionKey: handler.key,
              executionId: execution.id,
              conversationId,
            },
          });
        } catch (err) {
          logger.warn('actions.notification.failed', {
            companyId,
            actionKey: handler.key,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      logger.info('actions.executed', {
        companyId,
        conversationId,
        actionKey: handler.key,
        executionId: execution.id,
      });

      return {
        status: 'completed',
        actionKey: handler.key,
        replyText: result.summary,
        summary: result.summary,
        readOnly: handler.readOnly ?? false,
        executionId: execution.id,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'the action could not be completed';
      const execution = await actionsRepository.createExecution(companyId, {
        conversationId,
        generationId,
        actionKey: handler.key,
        input: parsed.data as Prisma.InputJsonValue,
        status: 'failed',
        errorMessage: message,
      });
      logger.warn('actions.failed', {
        companyId,
        conversationId,
        actionKey: handler.key,
        message,
      });
      return {
        status: 'failed',
        actionKey: handler.key,
        replyText: `Sorry, I couldn't complete that: ${message}`,
        summary: null,
        readOnly: handler.readOnly ?? false,
        executionId: execution.id,
      };
    }
  },

  /* --------------------- dashboard reads / status updates -------------------- */

  async listExecutions(
    companyId: string,
    query: {
      page: number;
      limit: number;
      actionKey?: string;
      status?: string;
    },
  ) {
    const { items, total } = await actionsRepository.listExecutions(
      companyId,
      query,
    );
    return paginate(items, total, query.page, query.limit);
  },

  async listAppointments(
    companyId: string,
    query: { page: number; limit: number; status?: AppointmentStatus },
  ) {
    const { items, total } = await actionsRepository.listAppointments(
      companyId,
      query,
    );
    return paginate(items, total, query.page, query.limit);
  },

  async setAppointmentStatus(
    companyId: string,
    id: string,
    status: AppointmentStatus,
  ) {
    const appointment = await actionsRepository.updateAppointmentStatus(
      companyId,
      id,
      status,
    );
    if (!appointment) throw AppError.notFound('Appointment not found');
    return appointment;
  },

  async listOrders(
    companyId: string,
    query: { page: number; limit: number; status?: OrderStatus },
  ) {
    const { items, total } = await actionsRepository.listOrders(
      companyId,
      query,
    );
    return paginate(items, total, query.page, query.limit);
  },

  async setOrderStatus(companyId: string, id: string, status: OrderStatus) {
    const order = await actionsRepository.updateOrderStatus(
      companyId,
      id,
      status,
    );
    if (!order) throw AppError.notFound('Order not found');
    return order;
  },

  async listTickets(
    companyId: string,
    query: { page: number; limit: number; status?: TicketStatus },
  ) {
    const { items, total } = await actionsRepository.listTickets(
      companyId,
      query,
    );
    return paginate(items, total, query.page, query.limit);
  },

  async setTicketStatus(companyId: string, id: string, status: TicketStatus) {
    const ticket = await actionsRepository.updateTicketStatus(
      companyId,
      id,
      status,
    );
    if (!ticket) throw AppError.notFound('Ticket not found');
    return ticket;
  },
};
