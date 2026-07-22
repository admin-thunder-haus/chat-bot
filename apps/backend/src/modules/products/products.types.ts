import type { Product } from '@prisma/client';

/**
 * API representation of a product. The Prisma `Decimal` price is serialized to
 * a string (or null) so clients never receive an unusable Decimal object and
 * never lose precision to floating point. A null price means "price on
 * request" / not published.
 */
export interface SerializedProduct {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  sku: string | null;
  category: string | null;
  price: string | null;
  currency: string;
  stockQuantity: number | null;
  imageUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductListFilters {
  page: number;
  limit: number;
  search?: string;
  isActive?: boolean;
  category?: string;
  sortBy: 'sortOrder' | 'name' | 'price' | 'createdAt' | 'updatedAt';
  sortOrder: 'asc' | 'desc';
}

/** Convert a Prisma row into the API shape. */
export function serializeProduct(row: Product): SerializedProduct {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    description: row.description,
    sku: row.sku,
    category: row.category,
    price: row.price === null ? null : row.price.toString(),
    currency: row.currency,
    stockQuantity: row.stockQuantity,
    imageUrl: row.imageUrl,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
