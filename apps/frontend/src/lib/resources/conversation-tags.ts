import { request } from '../api';
import type { Tag } from '../types';

export interface TagInput {
  name?: string;
  color?: string | null;
}

export const tagsApi = {
  list(): Promise<{ tags: Tag[] }> {
    return request('/conversation-tags', { auth: true });
  },
  create(input: TagInput): Promise<{ tag: Tag }> {
    return request('/conversation-tags', {
      method: 'POST',
      body: input,
      auth: true,
    });
  },
  update(id: string, input: TagInput): Promise<{ tag: Tag }> {
    return request(`/conversation-tags/${id}`, {
      method: 'PATCH',
      body: input,
      auth: true,
    });
  },
  remove(id: string): Promise<null> {
    return request(`/conversation-tags/${id}`, { method: 'DELETE', auth: true });
  },
};
