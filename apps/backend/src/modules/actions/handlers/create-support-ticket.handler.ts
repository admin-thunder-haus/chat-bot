import { z } from 'zod';
import type {
  ActionContext,
  ActionHandler,
  ActionResult,
} from '../action-registry';
import { actionsRepository } from '../actions.repository';

const inputSchema = z.object({
  subject: z
    .string({ required_error: 'a short subject describing the issue' })
    .trim()
    .min(3, 'must be at least 3 characters')
    .max(120, 'must be at most 120 characters'),
  description: z.string().trim().max(2000).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
});

type Input = z.infer<typeof inputSchema>;

/** Opens an OPEN support ticket the team follows up on from Operations. */
export const createSupportTicketHandler: ActionHandler = {
  key: 'create_support_ticket',
  description:
    'Create a support ticket when the customer reports a problem the team must follow up on.',
  inputSchema,
  inputExample: {
    subject: 'Damaged item in order',
    description: 'The mug arrived cracked',
    priority: 'HIGH',
  },

  async execute(
    ctx: ActionContext,
    rawInput: Record<string, unknown>,
  ): Promise<ActionResult> {
    const input = rawInput as Input;
    const priority = input.priority ?? 'NORMAL';

    const ticket = await actionsRepository.createTicket(ctx.companyId, {
      customerId: ctx.customerId ?? null,
      conversationId: ctx.conversationId ?? null,
      subject: input.subject,
      description: input.description ?? null,
      priority,
      status: 'OPEN',
      createdVia: 'ai',
    });

    return {
      summary: `Support ticket created: "${input.subject}" (priority ${priority}). Our team will follow up with you.`,
      data: {
        ticketId: ticket.id,
        subject: ticket.subject,
        priority: ticket.priority,
        status: ticket.status,
      },
    };
  },
};
