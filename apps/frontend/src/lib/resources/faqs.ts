import { request } from '../api';
import { toQuery } from './query';
import type { Faq, Paginated } from '../types';

export interface FaqInput {
  question?: string;
  answer?: string;
  category?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

export interface FaqListParams {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  isActive?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const faqsApi = {
  list(params: FaqListParams = {}): Promise<Paginated<Faq>> {
    return request(`/faqs${toQuery(params)}`, { auth: true });
  },
  get(id: string): Promise<{ faq: Faq }> {
    return request(`/faqs/${id}`, { auth: true });
  },
  create(input: FaqInput): Promise<{ faq: Faq }> {
    return request('/faqs', { method: 'POST', body: input, auth: true });
  },
  update(id: string, input: FaqInput): Promise<{ faq: Faq }> {
    return request(`/faqs/${id}`, { method: 'PATCH', body: input, auth: true });
  },
  setStatus(id: string, isActive: boolean): Promise<{ faq: Faq }> {
    return request(`/faqs/${id}/status`, {
      method: 'PATCH',
      body: { isActive },
      auth: true,
    });
  },
  remove(id: string): Promise<null> {
    return request(`/faqs/${id}`, { method: 'DELETE', auth: true });
  },
  reorder(items: { id: string; sortOrder: number }[]): Promise<{ faqs: Faq[] }> {
    return request('/faqs/reorder', {
      method: 'PATCH',
      body: { items },
      auth: true,
    });
  },
};
