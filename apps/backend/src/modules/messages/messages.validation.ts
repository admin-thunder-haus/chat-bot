import { z } from 'zod';
import { MAX_MESSAGE_LENGTH } from '../conversations/conversations.validation';

export const sendMessageSchema = z
  .object({
    // Reject empty/whitespace-only content; enforce a sane max length.
    content: z
      .string()
      .trim()
      .min(1, 'Message content is required')
      .max(MAX_MESSAGE_LENGTH, `Message must be at most ${MAX_MESSAGE_LENGTH} characters`),
    replyToMessageId: z.string().uuid().optional(),
  })
  .strict();

/**
 * Cursor pagination for chat history: `limit` newest messages by default,
 * `before` (a message id) to page backwards into older history.
 */
export const messageListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.string().uuid().optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type MessageListQuery = z.infer<typeof messageListQuerySchema>;
