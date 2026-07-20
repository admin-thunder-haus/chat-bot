import { request } from '../api';
import { toQuery } from './query';
import type {
  ChannelType,
  Customer,
  Paginated,
  ConversationListItem,
} from '../types';

export interface CustomerInput {
  channelType?: ChannelType;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  username?: string | null;
  notes?: string | null;
}

export interface CustomerListParams {
  page?: number;
  limit?: number;
  search?: string;
  channelType?: ChannelType;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const customersApi = {
  list(params: CustomerListParams = {}): Promise<Paginated<Customer>> {
    return request(`/customers${toQuery(params)}`, { auth: true });
  },
  get(id: string): Promise<{ customer: Customer }> {
    return request(`/customers/${id}`, { auth: true });
  },
  create(input: CustomerInput): Promise<{ customer: Customer }> {
    return request('/customers', { method: 'POST', body: input, auth: true });
  },
  update(id: string, input: CustomerInput): Promise<{ customer: Customer }> {
    return request(`/customers/${id}`, {
      method: 'PATCH',
      body: input,
      auth: true,
    });
  },
  conversations(
    id: string,
    params: { page?: number; limit?: number } = {},
  ): Promise<Paginated<ConversationListItem>> {
    return request(`/customers/${id}/conversations${toQuery(params)}`, {
      auth: true,
    });
  },
};
