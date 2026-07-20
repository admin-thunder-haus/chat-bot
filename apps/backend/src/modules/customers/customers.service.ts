import type { Customer, Prisma } from '@prisma/client';
import { customersRepository } from './customers.repository';
import { AppError } from '../../utils/AppError';
import { paginate, type PaginatedResult } from '../../utils/pagination';
import type {
  CreateCustomerInput,
  CustomerListQuery,
  UpdateCustomerInput,
} from './customers.validation';

const MAX_METADATA_BYTES = 10_000;

function assertMetadataSize(metadata: unknown): void {
  if (metadata === undefined) return;
  if (JSON.stringify(metadata).length > MAX_METADATA_BYTES) {
    throw AppError.badRequest('Validation failed', [
      { field: 'metadata', message: 'Metadata is too large' },
    ]);
  }
}

export const customersService = {
  async list(
    companyId: string,
    query: CustomerListQuery,
  ): Promise<PaginatedResult<Customer>> {
    const { items, total } = await customersRepository.list(companyId, query);
    return paginate(items, total, query.page, query.limit);
  },

  async getById(companyId: string, id: string): Promise<Customer> {
    const customer = await customersRepository.findByIdScoped(companyId, id);
    if (!customer) throw AppError.notFound('Customer not found');
    return customer;
  },

  create(companyId: string, input: CreateCustomerInput): Promise<Customer> {
    assertMetadataSize(input.metadata);
    return customersRepository.create(companyId, {
      channelType: input.channelType,
      externalId: input.externalId ?? null,
      fullName: input.fullName ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      username: input.username ?? null,
      avatarUrl: input.avatarUrl ?? null,
      notes: input.notes ?? null,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue,
    });
  },

  async update(
    companyId: string,
    id: string,
    input: UpdateCustomerInput,
  ): Promise<Customer> {
    assertMetadataSize(input.metadata);
    const updated = await customersRepository.update(
      companyId,
      id,
      input as Prisma.CustomerUpdateManyMutationInput,
    );
    if (!updated) throw AppError.notFound('Customer not found');
    return updated;
  },
};
