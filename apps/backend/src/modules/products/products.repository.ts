import type { Product, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { toSkipTake } from '../../utils/pagination';
import type { ProductListFilters } from './products.types';

/**
 * Data-access for products. EVERY query is scoped by companyId so a tenant
 * can only ever touch its own rows.
 */
export const productsRepository = {
  create(
    companyId: string,
    data: Omit<Prisma.ProductUncheckedCreateInput, 'companyId'>,
  ): Promise<Product> {
    return prisma.product.create({
      data: { ...data, companyId },
    });
  },

  findByIdScoped(companyId: string, id: string): Promise<Product | null> {
    return prisma.product.findFirst({ where: { id, companyId } });
  },

  async list(
    companyId: string,
    filters: ProductListFilters,
  ): Promise<{ items: Product[]; total: number }> {
    const where: Prisma.ProductWhereInput = { companyId };

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }
    if (filters.category) {
      where.category = { equals: filters.category, mode: 'insensitive' };
    }
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { sku: { contains: filters.search, mode: 'insensitive' } },
        { category: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const { skip, take } = toSkipTake(filters.page, filters.limit);
    // Secondary sort by name keeps ordering stable when sortOrder ties.
    const orderBy: Prisma.ProductOrderByWithRelationInput[] = [
      { [filters.sortBy]: filters.sortOrder },
      { name: 'asc' },
    ];

    const [items, total] = await prisma.$transaction([
      prisma.product.findMany({ where, orderBy, skip, take }),
      prisma.product.count({ where }),
    ]);

    return { items, total };
  },

  /** Scoped update; returns the updated row or null if it wasn't the tenant's. */
  async update(
    companyId: string,
    id: string,
    data: Prisma.ProductUpdateManyMutationInput,
  ): Promise<Product | null> {
    const result = await prisma.product.updateMany({
      where: { id, companyId },
      data,
    });
    if (result.count === 0) return null;
    return this.findByIdScoped(companyId, id);
  },

  /** Physical delete, scoped. Returns number of rows removed (0 or 1). */
  async remove(companyId: string, id: string): Promise<number> {
    const result = await prisma.product.deleteMany({
      where: { id, companyId },
    });
    return result.count;
  },

  /** How many of the given ids belong to this company (ownership check). */
  countByIds(companyId: string, ids: string[]): Promise<number> {
    return prisma.product.count({
      where: { companyId, id: { in: ids } },
    });
  },

  /** Batch reorder inside a single transaction. */
  async reorder(
    companyId: string,
    items: { id: string; sortOrder: number }[],
  ): Promise<void> {
    await prisma.$transaction(
      items.map((item) =>
        prisma.product.updateMany({
          where: { id: item.id, companyId },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
  },

  nameExists(
    companyId: string,
    name: string,
    excludeId?: string,
  ): Promise<boolean> {
    return prisma.product
      .findFirst({
        where: {
          companyId,
          name,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { id: true },
      })
      .then((r) => r !== null);
  },

  skuExists(
    companyId: string,
    sku: string,
    excludeId?: string,
  ): Promise<boolean> {
    return prisma.product
      .findFirst({
        where: {
          companyId,
          sku,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { id: true },
      })
      .then((r) => r !== null);
  },

  /** All of a company's products in display order (used after reordering). */
  listOrdered(companyId: string): Promise<Product[]> {
    return prisma.product.findMany({
      where: { companyId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  },

  /**
   * Excel import commit. `replace` first removes every existing product;
   * `merge` upserts by the company-unique name. Runs in ONE transaction so a
   * failed import never leaves a half-replaced catalog.
   */
  async importRows(
    companyId: string,
    rows: Omit<Prisma.ProductUncheckedCreateInput, 'companyId'>[],
    mode: 'merge' | 'replace',
  ): Promise<{ created: number; updated: number; deleted: number }> {
    return prisma.$transaction(async (tx) => {
      let deleted = 0;
      let created = 0;
      let updated = 0;

      if (mode === 'replace') {
        const res = await tx.product.deleteMany({ where: { companyId } });
        deleted = res.count;
      }

      for (const row of rows) {
        if (mode === 'merge') {
          const existing = await tx.product.findFirst({
            where: { companyId, name: row.name as string },
            select: { id: true },
          });
          if (existing) {
            await tx.product.update({
              where: { id: existing.id },
              data: row,
            });
            updated += 1;
            continue;
          }
        }
        await tx.product.create({ data: { ...row, companyId } });
        created += 1;
      }

      return { created, updated, deleted };
    });
  },

  countAll(companyId: string): Promise<number> {
    return prisma.product.count({ where: { companyId } });
  },

  countActive(companyId: string): Promise<number> {
    return prisma.product.count({
      where: { companyId, isActive: true },
    });
  },
};
