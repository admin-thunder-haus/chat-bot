import { ApiClientError, apiUrl, getAccessToken, request } from '../api';
import type { KnowledgeDocument } from '../types';

export const documentsApi = {
  list(): Promise<{ documents: KnowledgeDocument[] }> {
    return request('/knowledge-documents', { auth: true });
  },

  /** Upload up to 5 PDFs (repeated "files" multipart field). */
  upload(files: File[]): Promise<{ documents: KnowledgeDocument[] }> {
    const form = new FormData();
    for (const file of files) form.append('files', file);
    return request('/knowledge-documents', {
      method: 'POST',
      body: form,
      auth: true,
    });
  },

  /** Replace the underlying PDF of an existing document. */
  replace(id: string, file: File): Promise<{ document: KnowledgeDocument }> {
    const form = new FormData();
    form.append('files', file);
    return request(`/knowledge-documents/${id}/replace`, {
      method: 'POST',
      body: form,
      auth: true,
    });
  },

  setStatus(
    id: string,
    isActive: boolean,
  ): Promise<{ document: KnowledgeDocument }> {
    return request(`/knowledge-documents/${id}/status`, {
      method: 'PATCH',
      body: { isActive },
      auth: true,
    });
  },

  remove(id: string): Promise<null> {
    return request(`/knowledge-documents/${id}`, {
      method: 'DELETE',
      auth: true,
    });
  },

  /**
   * Download the original PDF. The endpoint needs the bearer token, so a plain
   * <a href> cannot be used — fetch as a blob and trigger a client download.
   */
  async download(id: string, fileName: string): Promise<void> {
    const token = getAccessToken();
    const res = await fetch(apiUrl(`/knowledge-documents/${id}/download`), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      credentials: 'include',
    });
    if (!res.ok) {
      throw new ApiClientError(
        `Download failed with status ${res.status}`,
        res.status,
      );
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },
};
