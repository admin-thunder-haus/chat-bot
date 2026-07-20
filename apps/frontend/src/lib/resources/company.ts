import { request } from '../api';
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
};
