import { servicesRepository } from './services.repository';
import { AppError } from '../../utils/AppError';
import { paginate, type PaginatedResult } from '../../utils/pagination';
import {
  buildImportPreview,
  parseSpreadsheet,
  type ImportPreview,
} from '../../utils/spreadsheet';
import {
  serializeService,
  type SerializedService,
} from './services.types';
import { PRICED_TYPES, serviceImportRowSchema } from './services.validation';
import type {
  CreateServiceInput,
  ReorderInput,
  ServiceImportRow,
  ServiceListQuery,
  UpdateServiceInput,
} from './services.validation';
import type { ServicePriceType } from '@prisma/client';

/** Guard: a priced service must carry a non-null price. */
function requirePrice(
  priceType: ServicePriceType,
  price: number | null | undefined,
): string | null {
  if (!PRICED_TYPES.includes(priceType)) {
    // VARIABLE / CONTACT_US / FREE never store a price.
    return null;
  }
  if (price === null || price === undefined) {
    throw AppError.badRequest('Validation failed', [
      { field: 'price', message: 'Price is required for this price type' },
    ]);
  }
  return price.toString();
}

export const servicesService = {
  async list(
    companyId: string,
    query: ServiceListQuery,
  ): Promise<PaginatedResult<SerializedService>> {
    const { items, total } = await servicesRepository.list(companyId, query);
    return paginate(
      items.map(serializeService),
      total,
      query.page,
      query.limit,
    );
  },

  async getById(companyId: string, id: string): Promise<SerializedService> {
    const service = await servicesRepository.findByIdScoped(companyId, id);
    if (!service) throw AppError.notFound('Service not found');
    return serializeService(service);
  },

  async create(
    companyId: string,
    input: CreateServiceInput,
  ): Promise<SerializedService> {
    if (await servicesRepository.nameExists(companyId, input.name)) {
      throw AppError.conflict('A service with this name already exists', [
        { field: 'name', message: 'Name is already in use' },
      ]);
    }

    const price = requirePrice(input.priceType, input.price);

    const created = await servicesRepository.create(companyId, {
      name: input.name,
      description: input.description ?? null,
      price,
      currency: input.currency,
      priceType: input.priceType,
      durationMinutes: input.durationMinutes ?? null,
      imageUrl: input.imageUrl ?? null,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
    });

    return serializeService(created);
  },

  async update(
    companyId: string,
    id: string,
    input: UpdateServiceInput,
  ): Promise<SerializedService> {
    const existing = await servicesRepository.findByIdScoped(companyId, id);
    if (!existing) throw AppError.notFound('Service not found');

    if (input.name && input.name !== existing.name) {
      if (await servicesRepository.nameExists(companyId, input.name, id)) {
        throw AppError.conflict('A service with this name already exists', [
          { field: 'name', message: 'Name is already in use' },
        ]);
      }
    }

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.durationMinutes !== undefined) {
      data.durationMinutes = input.durationMinutes;
    }
    if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

    // Re-resolve price whenever priceType or price is part of the update.
    if (input.priceType !== undefined || input.price !== undefined) {
      const finalType = input.priceType ?? existing.priceType;
      data.priceType = finalType;

      if (!PRICED_TYPES.includes(finalType)) {
        data.price = null;
      } else if (input.price !== undefined) {
        data.price = requirePrice(finalType, input.price);
      } else if (existing.price === null) {
        // Switching to a priced type without supplying a price.
        throw AppError.badRequest('Validation failed', [
          { field: 'price', message: 'Price is required for this price type' },
        ]);
      } else {
        data.price = existing.price.toString();
      }
    }

    const updated = await servicesRepository.update(companyId, id, data);
    if (!updated) throw AppError.notFound('Service not found');
    return serializeService(updated);
  },

  async setStatus(
    companyId: string,
    id: string,
    isActive: boolean,
  ): Promise<SerializedService> {
    const updated = await servicesRepository.update(companyId, id, {
      isActive,
    });
    if (!updated) throw AppError.notFound('Service not found');
    return serializeService(updated);
  },

  async remove(companyId: string, id: string): Promise<void> {
    const count = await servicesRepository.remove(companyId, id);
    if (count === 0) throw AppError.notFound('Service not found');
  },

  async reorder(
    companyId: string,
    input: ReorderInput,
  ): Promise<SerializedService[]> {
    const ids = input.items.map((i) => i.id);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      throw AppError.badRequest('Validation failed', [
        { field: 'items', message: 'Duplicate service ids are not allowed' },
      ]);
    }

    // Every id must belong to the authenticated company.
    const owned = await servicesRepository.countByIds(companyId, ids);
    if (owned !== ids.length) {
      throw AppError.notFound('One or more services were not found');
    }

    await servicesRepository.reorder(companyId, input.items);
    const ordered = await servicesRepository.listOrdered(companyId);
    return ordered.map(serializeService);
  },

  /** Parse + validate an uploaded Excel file without writing anything. */
  async importPreview(
    fileBuffer: Buffer,
  ): Promise<ImportPreview<ServiceImportRow>> {
    const parsed = await parseSpreadsheet(fileBuffer);
    return buildImportPreview(parsed, serviceImportRowSchema, {
      uniqueField: 'name',
    });
  },

  /**
   * Commit an Excel import. The file is fully re-validated server-side; any
   * invalid row aborts the commit (clients preview first, so this is a
   * safety net, not the primary UX).
   */
  async importCommit(
    companyId: string,
    fileBuffer: Buffer,
    mode: 'merge' | 'replace',
  ): Promise<{
    created: number;
    updated: number;
    deleted: number;
    total: number;
  }> {
    const preview = await this.importPreview(fileBuffer);

    if (preview.summary.totalRows === 0) {
      throw AppError.badRequest('The file contains no data rows');
    }
    if (preview.summary.invalidRows > 0) {
      const first = preview.rows.find((r) => r.errors.length > 0);
      throw AppError.badRequest(
        `The file contains ${preview.summary.invalidRows} invalid row(s). Fix them and try again.`,
        first
          ? first.errors.map((e) => ({
              field: e.field,
              message: `Row ${first.rowNumber}: ${e.message}`,
            }))
          : [],
      );
    }

    const rows = preview.rows.map((r, index) => {
      const row = r.data!;
      return {
        name: row.name,
        description: row.description,
        // Non-priced types never store a price, mirroring create().
        price: PRICED_TYPES.includes(row.priceType)
          ? row.price!.toString()
          : null,
        currency: row.currency,
        priceType: row.priceType,
        durationMinutes: row.durationMinutes,
        imageUrl: row.imageUrl,
        isActive: row.isActive,
        // File order becomes display order unless the sheet specifies one.
        sortOrder: row.sortOrder ?? index,
      };
    });

    const result = await servicesRepository.importRows(companyId, rows, mode);
    return { ...result, total: rows.length };
  },
};
