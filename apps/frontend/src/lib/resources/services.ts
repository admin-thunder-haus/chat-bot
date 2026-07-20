import { request } from '../api';
import { toQuery } from './query';
import type { Paginated, Service, ServicePriceType } from '../types';

export interface ServiceInput {
  name?: string;
  description?: string | null;
  price?: number | null;
  currency?: string;
  priceType?: ServicePriceType;
  durationMinutes?: number | null;
  isActive?: boolean;
  sortOrder?: number;
}

export interface ServiceListParams {
  page?: number;
  limit?: number;
  search?: string;
  isActive?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const servicesApi = {
  list(params: ServiceListParams = {}): Promise<Paginated<Service>> {
    return request(`/services${toQuery(params)}`, { auth: true });
  },
  get(id: string): Promise<{ service: Service }> {
    return request(`/services/${id}`, { auth: true });
  },
  create(input: ServiceInput): Promise<{ service: Service }> {
    return request('/services', { method: 'POST', body: input, auth: true });
  },
  update(id: string, input: ServiceInput): Promise<{ service: Service }> {
    return request(`/services/${id}`, {
      method: 'PATCH',
      body: input,
      auth: true,
    });
  },
  setStatus(id: string, isActive: boolean): Promise<{ service: Service }> {
    return request(`/services/${id}/status`, {
      method: 'PATCH',
      body: { isActive },
      auth: true,
    });
  },
  remove(id: string): Promise<null> {
    return request(`/services/${id}`, { method: 'DELETE', auth: true });
  },
  reorder(
    items: { id: string; sortOrder: number }[],
  ): Promise<{ services: Service[] }> {
    return request('/services/reorder', {
      method: 'PATCH',
      body: { items },
      auth: true,
    });
  },
};
