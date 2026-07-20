import { request } from '../api';
import { toQuery } from './query';
import type { KnowledgeEntry, Paginated } from '../types';

export interface KnowledgeInput {
  title?: string;
  content?: string;
  category?: string | null;
  tags?: string[];
  isActive?: boolean;
  sortOrder?: number;
}

export interface KnowledgeListParams {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  tag?: string;
  isActive?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const knowledgeApi = {
  list(params: KnowledgeListParams = {}): Promise<Paginated<KnowledgeEntry>> {
    return request(`/knowledge-base${toQuery(params)}`, { auth: true });
  },
  get(id: string): Promise<{ entry: KnowledgeEntry }> {
    return request(`/knowledge-base/${id}`, { auth: true });
  },
  create(input: KnowledgeInput): Promise<{ entry: KnowledgeEntry }> {
    return request('/knowledge-base', {
      method: 'POST',
      body: input,
      auth: true,
    });
  },
  update(id: string, input: KnowledgeInput): Promise<{ entry: KnowledgeEntry }> {
    return request(`/knowledge-base/${id}`, {
      method: 'PATCH',
      body: input,
      auth: true,
    });
  },
  setStatus(id: string, isActive: boolean): Promise<{ entry: KnowledgeEntry }> {
    return request(`/knowledge-base/${id}/status`, {
      method: 'PATCH',
      body: { isActive },
      auth: true,
    });
  },
  remove(id: string): Promise<null> {
    return request(`/knowledge-base/${id}`, { method: 'DELETE', auth: true });
  },
  reorder(
    items: { id: string; sortOrder: number }[],
  ): Promise<{ entries: KnowledgeEntry[] }> {
    return request('/knowledge-base/reorder', {
      method: 'PATCH',
      body: { items },
      auth: true,
    });
  },
};
