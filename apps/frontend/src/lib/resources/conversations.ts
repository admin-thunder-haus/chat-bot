import { request } from '../api';
import { toQuery } from './query';
import type {
  Activity,
  ConversationDetail,
  ConversationListItem,
  ConversationPriority,
  ConversationStatus,
  Paginated,
  Tag,
} from '../types';

export interface ConversationListParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: ConversationStatus;
  priority?: ConversationPriority;
  channelType?: string;
  assignedUserId?: string;
  unassigned?: boolean;
  unreadOnly?: boolean;
  archived?: boolean;
  tagId?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface CreateConversationInput {
  customerId: string;
  subject?: string;
  priority?: ConversationPriority;
  initialMessage?: string;
}

export const conversationsApi = {
  list(
    params: ConversationListParams = {},
  ): Promise<Paginated<ConversationListItem>> {
    return request(`/conversations${toQuery(params)}`, { auth: true });
  },
  get(id: string): Promise<{ conversation: ConversationDetail }> {
    return request(`/conversations/${id}`, { auth: true });
  },
  create(
    input: CreateConversationInput,
  ): Promise<{ conversation: ConversationDetail }> {
    return request('/conversations', { method: 'POST', body: input, auth: true });
  },
  setStatus(
    id: string,
    status: ConversationStatus,
  ): Promise<{ conversation: ConversationDetail }> {
    return request(`/conversations/${id}/status`, {
      method: 'PATCH',
      body: { status },
      auth: true,
    });
  },
  setPriority(
    id: string,
    priority: ConversationPriority,
  ): Promise<{ conversation: ConversationDetail }> {
    return request(`/conversations/${id}/priority`, {
      method: 'PATCH',
      body: { priority },
      auth: true,
    });
  },
  setAssignment(
    id: string,
    assignedUserId: string | null,
  ): Promise<{ conversation: ConversationDetail }> {
    return request(`/conversations/${id}/assignment`, {
      method: 'PATCH',
      body: { assignedUserId },
      auth: true,
    });
  },
  setArchived(
    id: string,
    isArchived: boolean,
  ): Promise<{ conversation: ConversationDetail }> {
    return request(`/conversations/${id}/archive`, {
      method: 'PATCH',
      body: { isArchived },
      auth: true,
    });
  },
  markRead(id: string): Promise<{ conversation: ConversationDetail }> {
    return request(`/conversations/${id}/read`, { method: 'PATCH', auth: true });
  },
  activity(id: string): Promise<{ activities: Activity[] }> {
    return request(`/conversations/${id}/activity`, { auth: true });
  },
  attachTag(id: string, tagId: string): Promise<{ tags: Tag[] }> {
    return request(`/conversations/${id}/tags/${tagId}`, {
      method: 'POST',
      auth: true,
    });
  },
  detachTag(id: string, tagId: string): Promise<{ tags: Tag[] }> {
    return request(`/conversations/${id}/tags/${tagId}`, {
      method: 'DELETE',
      auth: true,
    });
  },
};
