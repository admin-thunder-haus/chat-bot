import type { BusinessService, ServicePriceType } from '@prisma/client';

/**
 * API representation of a service. The Prisma `Decimal` price is serialized to
 * a string (or null) so clients never receive an unusable Decimal object and
 * never lose precision to floating point.
 */
export interface SerializedService {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  price: string | null;
  currency: string;
  priceType: ServicePriceType;
  durationMinutes: number | null;
  imageUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServiceListFilters {
  page: number;
  limit: number;
  search?: string;
  isActive?: boolean;
  sortBy: 'sortOrder' | 'name' | 'price' | 'createdAt' | 'updatedAt';
  sortOrder: 'asc' | 'desc';
}

/** Convert a Prisma row into the API shape. */
export function serializeService(row: BusinessService): SerializedService {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    description: row.description,
    price: row.price === null ? null : row.price.toString(),
    currency: row.currency,
    priceType: row.priceType,
    durationMinutes: row.durationMinutes,
    imageUrl: row.imageUrl,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
