export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

/** Convert a (page, limit) pair into Prisma `skip`/`take`. */
export function toSkipTake(page: number, limit: number): {
  skip: number;
  take: number;
} {
  return { skip: (page - 1) * limit, take: limit };
}

/** Build the pagination metadata block returned by list endpoints. */
export function buildPaginationMeta(
  total: number,
  page: number,
  limit: number,
): PaginationMeta {
  return {
    page,
    limit,
    total,
    totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
  };
}

/** Assemble a `{ items, pagination }` payload. */
export function paginate<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResult<T> {
  return { items, pagination: buildPaginationMeta(total, page, limit) };
}
