import { ApiClientError, apiUrl, getAccessToken, request } from '../api';
import type { Company } from '../types';

export interface ProfileUpdate {
  name?: string;
  displayName?: string | null;
  description?: string | null;
  industry?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsappNumber?: string | null;
  websiteUrl?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  timezone?: string;
  defaultLanguage?: string;
  responseLanguage?: string;
}

export const companyApi = {
  getProfile(): Promise<{ company: Company }> {
    return request('/company/profile', { auth: true });
  },
  updateProfile(input: ProfileUpdate): Promise<{ company: Company }> {
    return request('/company/profile', {
      method: 'PATCH',
      body: input,
      auth: true,
    });
  },

  /**
   * Download the workspace's data as JSON (GDPR portability). Same approach as
   * the document download: the endpoint needs the bearer token, so a plain
   * <a href> cannot be used — fetch it and trigger a client-side save.
   */
  async exportData(): Promise<void> {
    const token = getAccessToken();
    const res = await fetch(apiUrl('/company/export'), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      credentials: 'include',
    });
    if (!res.ok) {
      throw new ApiClientError(
        `Export failed with status ${res.status}`,
        res.status,
      );
    }
    // Prefer the server's filename (it carries the slug and date).
    const disposition = res.headers.get('content-disposition') ?? '';
    const match = /filename="([^"]+)"/.exec(disposition);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = match?.[1] ?? 'company-export.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },

  /** Permanently delete the workspace. `confirmName` must match exactly. */
  deleteCompany(confirmName: string): Promise<{ deletedCompanyName: string }> {
    return request('/company', {
      method: 'DELETE',
      body: { confirmName },
      auth: true,
    });
  },
};
