import type { BusinessService, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { toSkipTake } from '../../utils/pagination';
import type { ServiceListFilters } from './services.types';

/**
 * Data-access for business services. EVERY query is scoped by companyId so a
 * tenant can only ever touch its own rows.
 */
export const servicesRepository = {
  create(
    companyId: string,
    data: Omit<Prisma.BusinessServiceUncheckedCreateInput, 'companyId'>,
  ): Promise<BusinessService> {
    return prisma.businessService.create({
      data: { ...data, companyId },
    });
  },

  findByIdScoped(
    companyId: string,
    id: string,
  ): Promise<BusinessService | null> {
    return prisma.businessService.findFirst({ where: { id, companyId } });
  },

  async list(
    companyId: string,
    filters: ServiceListFilters,
  ): Promise<{ items: BusinessService[]; total: number }> {
    const where: Prisma.BusinessServiceWhereInput = { companyId };

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const { skip, take } = toSkipTake(filters.page, filters.limit);
    // Secondary sort by name keeps ordering stable when sortOrder ties.
    const orderBy: Prisma.BusinessServiceOrderByWithRelationInput[] = [
      { [filters.sortBy]: filters.sortOrder },
      { name: 'asc' },
    ];

    const [items, total] = await prisma.$transaction([
      prisma.businessService.findMany({ where, orderBy, skip, take }),
      prisma.businessService.count({ where }),
    ]);

    return { items, total };
  },

  /** Scoped update; returns the updated row or null if it wasn't the tenant's. */
  async update(
    companyId: string,
    id: string,
    data: Prisma.BusinessServiceUpdateManyMutationInput,
  ): Promise<BusinessService | null> {
    const result = await prisma.businessService.updateMany({
      where: { id, companyId },
      data,
    });
    if (result.count === 0) return null;
    return this.findByIdScoped(companyId, id);
  },

  /** Physical delete, scoped. Returns number of rows removed (0 or 1). */
  async remove(companyId: string, id: string): Promise<number> {
    const result = await prisma.businessService.deleteMany({
      where: { id, companyId },
    });
    return result.count;
  },

  /** How many of the given ids belong to this company (ownership check). */
  countByIds(companyId: string, ids: string[]): Promise<number> {
    return prisma.businessService.count({
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
        prisma.businessService.updateMany({
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
    return prisma.businessService
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

  /** All of a company's services in display order (used after reordering). */
  listOrdered(companyId: string): Promise<BusinessService[]> {
    return prisma.businessService.findMany({
      where: { companyId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  },

  countAll(companyId: string): Promise<number> {
    return prisma.businessService.count({ where: { companyId } });
  },

  countActive(companyId: string): Promise<number> {
    return prisma.businessService.count({
      where: { companyId, isActive: true },
    });
  },
};
