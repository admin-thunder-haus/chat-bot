import { productsRepository } from './products.repository';
import { AppError, type AppErrorDetail } from '../../utils/AppError';
import { paginate, type PaginatedResult } from '../../utils/pagination';
import {
  buildImportPreview,
  parseSpreadsheet,
  type ImportPreview,
} from '../../utils/spreadsheet';
import {
  serializeProduct,
  type SerializedProduct,
} from './products.types';
import { productImportRowSchema } from './products.validation';
import type {
  CreateProductInput,
  ProductImportRow,
  ProductListQuery,
  ReorderInput,
  UpdateProductInput,
} from './products.validation';

export const productsService = {
  async list(
    companyId: string,
    query: ProductListQuery,
  ): Promise<PaginatedResult<SerializedProduct>> {
    const { items, total } = await productsRepository.list(companyId, query);
    return paginate(
      items.map(serializeProduct),
      total,
      query.page,
      query.limit,
    );
  },

  async getById(companyId: string, id: string): Promise<SerializedProduct> {
    const product = await productsRepository.findByIdScoped(companyId, id);
    if (!product) throw AppError.notFound('Product not found');
    return serializeProduct(product);
  },

  async create(
    companyId: string,
    input: CreateProductInput,
  ): Promise<SerializedProduct> {
    if (await productsRepository.nameExists(companyId, input.name)) {
      throw AppError.conflict('A product with this name already exists', [
        { field: 'name', message: 'Name is already in use' },
      ]);
    }
    if (input.sku && (await productsRepository.skuExists(companyId, input.sku))) {
      throw AppError.conflict('A product with this SKU already exists', [
        { field: 'sku', message: 'SKU is already in use' },
      ]);
    }

    const created = await productsRepository.create(companyId, {
      name: input.name,
      description: input.description ?? null,
      sku: input.sku ?? null,
      category: input.category ?? null,
      price: input.price === null || input.price === undefined
        ? null
        : input.price.toString(),
      currency: input.currency,
      stockQuantity: input.stockQuantity ?? null,
      imageUrl: input.imageUrl ?? null,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
    });

    return serializeProduct(created);
  },

  async update(
    companyId: string,
    id: string,
    input: UpdateProductInput,
  ): Promise<SerializedProduct> {
    const existing = await productsRepository.findByIdScoped(companyId, id);
    if (!existing) throw AppError.notFound('Product not found');

    if (input.name && input.name !== existing.name) {
      if (await productsRepository.nameExists(companyId, input.name, id)) {
        throw AppError.conflict('A product with this name already exists', [
          { field: 'name', message: 'Name is already in use' },
        ]);
      }
    }
    if (input.sku && input.sku !== existing.sku) {
      if (await productsRepository.skuExists(companyId, input.sku, id)) {
        throw AppError.conflict('A product with this SKU already exists', [
          { field: 'sku', message: 'SKU is already in use' },
        ]);
      }
    }

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.sku !== undefined) data.sku = input.sku;
    if (input.category !== undefined) data.category = input.category;
    if (input.price !== undefined) {
      data.price = input.price === null ? null : input.price.toString();
    }
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.stockQuantity !== undefined) {
      data.stockQuantity = input.stockQuantity;
    }
    if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

    const updated = await productsRepository.update(companyId, id, data);
    if (!updated) throw AppError.notFound('Product not found');
    return serializeProduct(updated);
  },

  async setStatus(
    companyId: string,
    id: string,
    isActive: boolean,
  ): Promise<SerializedProduct> {
    const updated = await productsRepository.update(companyId, id, {
      isActive,
    });
    if (!updated) throw AppError.notFound('Product not found');
    return serializeProduct(updated);
  },

  async remove(companyId: string, id: string): Promise<void> {
    const count = await productsRepository.remove(companyId, id);
    if (count === 0) throw AppError.notFound('Product not found');
  },

  async reorder(
    companyId: string,
    input: ReorderInput,
  ): Promise<SerializedProduct[]> {
    const ids = input.items.map((i) => i.id);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      throw AppError.badRequest('Validation failed', [
        { field: 'items', message: 'Duplicate product ids are not allowed' },
      ]);
    }

    // Every id must belong to the authenticated company.
    const owned = await productsRepository.countByIds(companyId, ids);
    if (owned !== ids.length) {
      throw AppError.notFound('One or more products were not found');
    }

    await productsRepository.reorder(companyId, input.items);
    const ordered = await productsRepository.listOrdered(companyId);
    return ordered.map(serializeProduct);
  },

  /** Parse + validate an uploaded Excel file without writing anything. */
  async importPreview(
    fileBuffer: Buffer,
  ): Promise<ImportPreview<ProductImportRow>> {
    const parsed = await parseSpreadsheet(fileBuffer);
    const preview = buildImportPreview(parsed, productImportRowSchema, {
      uniqueField: 'name',
    });

    // SKUs must also be unique within the file (when present).
    const seenSkus = new Set<string>();
    for (const row of preview.rows) {
      const sku = row.data?.sku;
      if (!sku) continue;
      const key = sku.toLowerCase();
      if (seenSkus.has(key)) {
        row.errors.push({
          field: 'sku',
          message: `Duplicate sku "${sku}" — already used by an earlier row`,
        });
        row.data = null;
      } else {
        seenSkus.add(key);
      }
    }

    const validRows = preview.rows.filter((r) => r.data !== null).length;
    preview.summary.validRows = validRows;
    preview.summary.invalidRows = preview.rows.length - validRows;
    return preview;
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
      const details: AppErrorDetail[] = first
        ? first.errors.map((e) => ({
            field: e.field,
            message: `Row ${first.rowNumber}: ${e.message}`,
          }))
        : [];
      throw AppError.badRequest(
        `The file contains ${preview.summary.invalidRows} invalid row(s). Fix them and try again.`,
        details,
      );
    }

    const rows = preview.rows.map((r, index) => {
      const row = r.data!;
      return {
        name: row.name,
        description: row.description,
        sku: row.sku,
        category: row.category,
        price: row.price === null ? null : row.price.toString(),
        currency: row.currency,
        stockQuantity: row.stockQuantity,
        imageUrl: row.imageUrl,
        isActive: row.isActive,
        // File order becomes display order unless the sheet specifies one.
        sortOrder: row.sortOrder ?? index,
      };
    });

    const result = await productsRepository.importRows(companyId, rows, mode);
    return { ...result, total: rows.length };
  },
};
