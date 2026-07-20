import type {
  ChannelType,
  ConversationPriority,
  ConversationStatus,
  Prisma,
} from '@prisma/client';
import { customerSummarySelect } from '../customers/customers.types';

export interface ConversationListFilters {
  page: number;
  limit: number;
  search?: string;
  status?: ConversationStatus;
  priority?: ConversationPriority;
  channelType?: ChannelType;
  assignedUserId?: string;
  unassigned?: boolean;
  unreadOnly?: boolean;
  archived?: boolean;
  tagId?: string;
  customerId?: string;
  sortBy: 'lastMessageAt' | 'createdAt' | 'updatedAt' | 'priority';
  sortOrder: 'asc' | 'desc';
}

/** Assigned-user summary embedded in conversation payloads (no sensitive data). */
export const assignedUserSelect = {
  id: true,
  fullName: true,
  email: true,
  role: true,
} satisfies Prisma.UserSelect;

/** Last-message preview select (kept tiny for list endpoints). */
const lastMessageSelect = {
  id: true,
  content: true,
  direction: true,
  senderType: true,
  status: true,
  createdAt: true,
} satisfies Prisma.MessageSelect;

/** Include used for conversation list rows — one query, no N+1. */
export const conversationListInclude = {
  customer: { select: customerSummarySelect },
  assignedUser: { select: assignedUserSelect },
  tagAssignments: { include: { tag: true } },
  messages: {
    take: 1,
    orderBy: { createdAt: 'desc' },
    select: lastMessageSelect,
  },
} satisfies Prisma.ConversationInclude;

/** Include used for a single conversation detail. */
export const conversationDetailInclude = {
  customer: true,
  assignedUser: { select: assignedUserSelect },
  tagAssignments: { include: { tag: true } },
} satisfies Prisma.ConversationInclude;
