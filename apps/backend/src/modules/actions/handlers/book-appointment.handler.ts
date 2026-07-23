import { z } from 'zod';
import type {
  ActionContext,
  ActionHandler,
  ActionResult,
} from '../action-registry';
import { actionsRepository } from '../actions.repository';

const inputSchema = z.object({
  /** Optional: matched against the company's active services (contains, case-insensitive). */
  serviceName: z.string().trim().min(1).max(120).optional(),
  dateTime: z
    .string({ required_error: 'the date and time for the appointment' })
    .trim()
    .refine(
      (v) => !Number.isNaN(Date.parse(v)),
      'must be a valid ISO date-time (e.g. 2026-08-01T15:00)',
    )
    .refine(
      (v) => Number.isNaN(Date.parse(v)) || Date.parse(v) > Date.now(),
      'must be in the future',
    ),
  durationMinutes: z.number().int().min(5).max(1440).optional(),
  notes: z.string().trim().max(1000).optional(),
});

type Input = z.infer<typeof inputSchema>;

function formatWhen(date: Date): string {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Books a PENDING appointment; a team member confirms it from Operations. */
export const bookAppointmentHandler: ActionHandler = {
  key: 'book_appointment',
  description:
    'Book an appointment for the customer at a specific date and time (optionally for a named service).',
  inputSchema,
  inputExample: {
    serviceName: 'Haircut',
    dateTime: '2026-08-01T15:00:00',
    notes: 'Prefers the afternoon',
  },

  async execute(
    ctx: ActionContext,
    rawInput: Record<string, unknown>,
  ): Promise<ActionResult> {
    // The actions service validated rawInput against inputSchema already.
    const input = rawInput as Input;

    const service = input.serviceName
      ? await actionsRepository.findServiceByName(
          ctx.companyId,
          input.serviceName,
        )
      : null;
    const scheduledAt = new Date(input.dateTime);

    const appointment = await actionsRepository.createAppointment(
      ctx.companyId,
      {
        customerId: ctx.customerId ?? null,
        conversationId: ctx.conversationId ?? null,
        serviceId: service?.id ?? null,
        scheduledAt,
        durationMinutes: input.durationMinutes ?? service?.durationMinutes ?? null,
        notes: input.notes ?? null,
        status: 'PENDING',
        createdVia: 'ai',
      },
    );

    const serviceLabel = service?.name ?? input.serviceName;
    const summary = serviceLabel
      ? `Appointment booked for ${formatWhen(scheduledAt)} (${serviceLabel}). Our team will confirm it shortly.`
      : `Appointment booked for ${formatWhen(scheduledAt)}. Our team will confirm it shortly.`;

    return {
      summary,
      data: {
        appointmentId: appointment.id,
        scheduledAt: scheduledAt.toISOString(),
        serviceId: service?.id ?? null,
        serviceName: serviceLabel ?? null,
        status: appointment.status,
      },
    };
  },
};
