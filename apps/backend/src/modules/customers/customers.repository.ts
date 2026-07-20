import type { ChannelType, Customer, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { toSkipTake } from '../../utils/pagination';
import type { CustomerListFilters } from './customers.types';

/** Tenant-scoped data-access for customers. */
export const customersRepository = {
  create(
    companyId: string,
    data: Omit<Prisma.CustomerUncheckedCreateInput, 'companyId'>,
  ): Promise<Customer> {
    return prisma.customer.create({ data: { ...data, companyId } });
  },

  findByIdScoped(companyId: string, id: string): Promise<Customer | null> {
    return prisma.customer.findFirst({ where: { id, companyId } });
  },

  findByExternal(
    companyId: string,
    channelType: ChannelType,
    externalId: string,
  ): Promise<Customer | null> {
    return prisma.customer.findFirst({
      where: { companyId, channelType, externalId },
    });
  },

  async list(
    companyId: string,
    filters: CustomerListFilters,
  ): Promise<{ items: Customer[]; total: number }> {
    const where: Prisma.CustomerWhereInput = { companyId };
    if (filters.channelType) where.channelType = filters.channelType;
    if (filters.search) {
      where.OR = [
        { fullName: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { phone: { contains: filters.search, mode: 'insensitive' } },
        { username: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const { skip, take } = toSkipTake(filters.page, filters.limit);
    const orderBy: Prisma.CustomerOrderByWithRelationInput[] = [
      { [filters.sortBy]: filters.sortOrder },
      { id: 'asc' },
    ];

    const [items, total] = await prisma.$transaction([
      prisma.customer.findMany({ where, orderBy, skip, take }),
      prisma.customer.count({ where }),
    ]);
    return { items, total };
  },

  async update(
    companyId: string,
    id: string,
    data: Prisma.CustomerUpdateManyMutationInput,
  ): Promise<Customer | null> {
    const result = await prisma.customer.updateMany({
      where: { id, companyId },
      data,
    });
    if (result.count === 0) return null;
    return this.findByIdScoped(companyId, id);
  },

  countAll(companyId: string): Promise<number> {
    return prisma.customer.count({ where: { companyId } });
  },
};
