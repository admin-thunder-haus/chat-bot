import { z } from 'zod';
import {
  ChannelType,
  ConversationPriority,
  ConversationStatus,
} from '@prisma/client';
import {
  booleanQuery,
  searchQuery,
  sortOrderQuery,
} from '../../validations/common.validation';

export const MAX_MESSAGE_LENGTH = 4000;

export const createConversationSchema = z
  .object({
    customerId: z.string().uuid('A valid customerId is required'),
    subject: z.string().trim().max(200).optional(),
    channelType: z.nativeEnum(ChannelType).default(ChannelType.MANUAL),
    priority: z.nativeEnum(ConversationPriority).optional(),
    initialMessage: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH).optional(),
  })
  .strict();

export const updateConversationSchema = z
  .object({
    subject: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().trim().max(200).nullable().optional(),
    ),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
  });

export const statusSchema = z
  .object({ status: z.nativeEnum(ConversationStatus) })
  .strict();

export const prioritySchema = z
  .object({ priority: z.nativeEnum(ConversationPriority) })
  .strict();

export const archiveSchema = z
  .object({ isArchived: z.boolean() })
  .strict();

export const conversationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: searchQuery,
  status: z.nativeEnum(ConversationStatus).optional(),
  priority: z.nativeEnum(ConversationPriority).optional(),
  channelType: z.nativeEnum(ChannelType).optional(),
  assignedUserId: z.string().uuid().optional(),
  unassigned: booleanQuery,
  unreadOnly: booleanQuery,
  archived: booleanQuery,
  tagId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  sortBy: z
    .enum(['lastMessageAt', 'createdAt', 'updatedAt', 'priority'])
    .default('lastMessageAt'),
  sortOrder: sortOrderQuery,
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;
