import { request } from '../api';
import { toQuery } from './query';
import type { Message } from '../types';

export interface MessagePage {
  items: Message[];
  hasMore: boolean;
  nextCursor: string | null;
  total: number;
}

export const messagesApi = {
  /**
   * Cursor pagination: omit `before` for the latest page; pass the previous
   * page's `nextCursor` as `before` to load older messages.
   */
  list(
    conversationId: string,
    params: { limit?: number; before?: string } = {},
  ): Promise<MessagePage> {
    return request(
      `/conversations/${conversationId}/messages${toQuery(params)}`,
      { auth: true },
    );
  },
  send(conversationId: string, content: string): Promise<{ message: Message }> {
    return request(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: { content },
      auth: true,
    });
  },
};
