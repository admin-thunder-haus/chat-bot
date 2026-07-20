import { request } from '../api';
import type { Note } from '../types';

export const notesApi = {
  list(conversationId: string): Promise<{ notes: Note[] }> {
    return request(`/conversations/${conversationId}/notes`, { auth: true });
  },
  create(conversationId: string, content: string): Promise<{ note: Note }> {
    return request(`/conversations/${conversationId}/notes`, {
      method: 'POST',
      body: { content },
      auth: true,
    });
  },
  update(
    conversationId: string,
    noteId: string,
    content: string,
  ): Promise<{ note: Note }> {
    return request(`/conversations/${conversationId}/notes/${noteId}`, {
      method: 'PATCH',
      body: { content },
      auth: true,
    });
  },
  remove(conversationId: string, noteId: string): Promise<null> {
    return request(`/conversations/${conversationId}/notes/${noteId}`, {
      method: 'DELETE',
      auth: true,
    });
  },
};
