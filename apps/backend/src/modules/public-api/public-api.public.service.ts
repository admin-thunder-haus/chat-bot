import type { Conversation, Customer, Message } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import { paginate, type PaginatedResult } from '../../utils/pagination';
import { companiesRepository } from '../companies/companies.repository';
import { conversationsRepository } from '../conversations/conversations.repository';
import { customersRepository } from '../customers/customers.repository';
import { messagesRepository } from '../messages/messages.repository';
import type { ApiKeyIdentity } from './api-key-auth.middleware';
import type { PublicListQuery } from './public-api.validation';

/**
 * Read-only surface exposed to third parties via API keys. Everything is
 * scoped by the KEY's companyId and serialized to a stable, minimal shape —
 * internal fields (assignment, unread accounting, AI bookkeeping) stay
 * private.
 */

const RECENT_MESSAGES_LIMIT = 20;

interface PublicConversation {
  id: string;
  channelType: string;
  status: string;
  priority: string;
  subject: string | null;
  customer: { id: string; fullName: string | null } | null;
  createdAt: Date;
  lastMessageAt: Date | null;
  resolvedAt: Date | null;
}

interface PublicMessage {
  id: string;
  direction: string;
  senderType: string;
  contentType: string;
  content: string;
  mediaUrl: string | null;
  status: string;
  createdAt: Date;
}

interface PublicCustomer {
  id: string;
  channelType: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  username: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
}

/** Works for both list rows and detail rows (any shape embedding a customer). */
type ConversationWithCustomer = Conversation & {
  customer: { id: string; fullName: string | null } | null;
};

function serializeConversation(
  row: ConversationWithCustomer,
): PublicConversation {
  return {
    id: row.id,
    channelType: row.channelType,
    status: row.status,
    priority: row.priority,
    subject: row.subject,
    customer: row.customer
      ? { id: row.customer.id, fullName: row.customer.fullName }
      : null,
    createdAt: row.createdAt,
    lastMessageAt: row.lastMessageAt,
    resolvedAt: row.resolvedAt,
  };
}

function serializeMessage(message: Message): PublicMessage {
  return {
    id: message.id,
    direction: message.direction,
    senderType: message.senderType,
    contentType: message.contentType,
    content: message.content,
    mediaUrl: message.mediaUrl,
    status: message.status,
    createdAt: message.createdAt,
  };
}

function serializeCustomer(customer: Customer): PublicCustomer {
  return {
    id: customer.id,
    channelType: customer.channelType,
    fullName: customer.fullName,
    email: customer.email,
    phone: customer.phone,
    username: customer.username,
    firstSeenAt: customer.firstSeenAt,
    lastSeenAt: customer.lastSeenAt,
    createdAt: customer.createdAt,
  };
}

export const publicApiPublicService = {
  /** Key + company introspection ("who am I?"). */
  async me(apiKey: ApiKeyIdentity): Promise<{
    company: { id: string; name: string };
    apiKey: { name: string; keyPrefix: string; scopes: string[] };
  }> {
    const company = await companiesRepository.findById(apiKey.companyId);
    if (!company) throw AppError.notFound('Company not found');
    return {
      company: { id: company.id, name: company.name },
      apiKey: {
        name: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
        scopes: apiKey.scopes,
      },
    };
  },

  async listConversations(
    companyId: string,
    query: PublicListQuery,
  ): Promise<PaginatedResult<PublicConversation>> {
    const { items, total } = await conversationsRepository.list(companyId, {
      page: query.page,
      limit: query.limit,
      sortBy: 'lastMessageAt',
      sortOrder: 'desc',
    });
    return paginate(
      items.map(serializeConversation),
      total,
      query.page,
      query.limit,
    );
  },

  async getConversation(
    companyId: string,
    id: string,
  ): Promise<{ conversation: PublicConversation; messages: PublicMessage[] }> {
    const detail = await conversationsRepository.findDetail(companyId, id);
    if (!detail) throw AppError.notFound('Conversation not found');
    const page = await messagesRepository.list(
      companyId,
      id,
      RECENT_MESSAGES_LIMIT,
    );
    return {
      conversation: serializeConversation(detail),
      messages: page.items.map(serializeMessage),
    };
  },

  async listCustomers(
    companyId: string,
    query: PublicListQuery,
  ): Promise<PaginatedResult<PublicCustomer>> {
    const { items, total } = await customersRepository.list(companyId, {
      page: query.page,
      limit: query.limit,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    return paginate(
      items.map(serializeCustomer),
      total,
      query.page,
      query.limit,
    );
  },
};
