import { z } from 'zod';
import { MAX_MESSAGE_LENGTH } from '../conversations/conversations.validation';

/** Public widget key in the route (opaque token, kept permissive on purpose). */
export const widgetParamsSchema = z.object({
  publicId: z.string().min(1).max(100),
});

/** Start / resume a session. All fields optional (anonymous-first). */
export const startSessionSchema = z
  .object({
    sessionToken: z.string().max(2000).optional(),
    visitorId: z.string().trim().min(1).max(191).optional(),
    visitor: z
      .object({
        name: z.string().trim().max(120).optional(),
        email: z.string().trim().toLowerCase().email().max(254).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Send an inbound message. `clientMessageId` gives idempotency for retries. */
export const widgetMessageSchema = z
  .object({
    content: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
    clientMessageId: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

/** Poll query. `after` is a message id cursor. */
export const widgetPollQuerySchema = z
  .object({
    after: z.string().uuid().optional(),
  })
  .strip();

/** Typing signal (architecture only in Part 3). */
export const widgetTypingSchema = z
  .object({
    isTyping: z.boolean().optional(),
  })
  .strip();

export type StartSessionInput = z.infer<typeof startSessionSchema>;
export type WidgetMessageInput = z.infer<typeof widgetMessageSchema>;
