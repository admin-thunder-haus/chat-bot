import { request } from '../api';
import { toQuery } from './query';
import type { ImportPreview, ImportResult, Paginated, Product } from '../types';

export interface ProductInput {
  name?: string;
  description?: string | null;
  sku?: string | null;
  category?: string | null;
  price?: number | null;
  currency?: string;
  stockQuantity?: number | null;
  imageUrl?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

export interface ProductListParams {
  page?: number;
  limit?: number;
  search?: string;
  isActive?: boolean;
  category?: string;
  sortBy?: 'sortOrder' | 'name' | 'price' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export const productsApi = {
  list(params: ProductListParams = {}): Promise<Paginated<Product>> {
    return request(`/products${toQuery(params)}`, { auth: true });
  },
  get(id: string): Promise<{ product: Product }> {
    return request(`/products/${id}`, { auth: true });
  },
  create(input: ProductInput): Promise<{ product: Product }> {
    return request('/products', { method: 'POST', body: input, auth: true });
  },
  update(id: string, input: ProductInput): Promise<{ product: Product }> {
    return request(`/products/${id}`, {
      method: 'PATCH',
      body: input,
      auth: true,
    });
  },
  setStatus(id: string, isActive: boolean): Promise<{ product: Product }> {
    return request(`/products/${id}/status`, {
      method: 'PATCH',
      body: { isActive },
      auth: true,
    });
  },
  remove(id: string): Promise<null> {
    return request(`/products/${id}`, { method: 'DELETE', auth: true });
  },
  reorder(
    items: { id: string; sortOrder: number }[],
  ): Promise<{ products: Product[] }> {
    return request('/products/reorder', {
      method: 'PATCH',
      body: { items },
      auth: true,
    });
  },
  importPreview(file: File): Promise<ImportPreview> {
    const form = new FormData();
    form.append('file', file);
    return request('/products/import/preview', {
      method: 'POST',
      body: form,
      auth: true,
    });
  },
  importCommit(file: File, mode: 'merge' | 'replace'): Promise<ImportResult> {
    const form = new FormData();
    form.append('file', file);
    form.append('mode', mode);
    return request('/products/import', {
      method: 'POST',
      body: form,
      auth: true,
    });
  },
};
