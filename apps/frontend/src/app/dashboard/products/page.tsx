'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { canWrite } from '@/lib/permissions';
import { productsApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { useToast } from '@/components/toast';
import type { Pagination, Product } from '@/lib/types';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  PageHeader,
  Panel,
  Select,
  Skeleton,
} from '@/components/ui';
import { ImportExcelModal } from '@/components/ImportExcelModal';
import { ProductFormModal } from './ProductFormModal';

const IMPORT_COLUMNS = [
  'name',
  'description',
  'sku',
  'category',
  'price',
  'currency',
  'stockQuantity',
  'imageUrl',
  'isActive',
  'sortOrder',
];

function priceDisplay(p: Product): string {
  if (p.price === null) return 'On request';
  return `${p.price} ${p.currency}`;
}

const LIMIT = 10;

export default function ProductsPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const readOnly = !canWrite(user?.role);

  const [items, setItems] = useState<Product[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'true' | 'false'>('all');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const canReorder = !readOnly && !search && activeFilter === 'all';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await productsApi.list({
        page,
        limit: LIMIT,
        search: search || undefined,
        isActive: activeFilter === 'all' ? undefined : activeFilter === 'true',
      });
      setItems(res.items);
      setPagination(res.pagination);
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [page, search, activeFilter]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  async function toggleStatus(p: Product) {
    try {
      await productsApi.setStatus(p.id, !p.isActive);
      notify('Status updated', 'success');
      load();
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await productsApi.remove(deleting.id);
      notify('Product deleted', 'success');
      setDeleting(null);
      load();
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setDeleteLoading(false);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const next = [...items];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    try {
      await productsApi.reorder(
        next.map((it, idx) => ({
          id: it.id,
          sortOrder: (page - 1) * LIMIT + idx,
        })),
      );
    } catch (err) {
      notify(parseApiError(err).message, 'error');
      load();
    }
  }

  return (
    <div>
      <PageHeader
        title="Products"
        description="Physical products your assistant can quote to customers."
        actions={
          !readOnly ? (
            <>
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                Import
              </Button>
              <Button
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
              >
                Add product
              </Button>
            </>
          ) : undefined
        }
      />

      {error && (
        <div className="mb-4">
          <Alert message={error} />
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Search products…"
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
          className="sm:max-w-xs"
        />
        <Select
          value={activeFilter}
          onChange={(e) => {
            setPage(1);
            setActiveFilter(e.target.value as 'all' | 'true' | 'false');
          }}
          className="sm:max-w-[160px]"
        >
          <option value="all">All statuses</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No products yet"
          description={
            readOnly
              ? 'No products have been added.'
              : 'Add your first product so the assistant can share pricing.'
          }
          action={
            !readOnly ? (
              <Button
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
              >
                Add product
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Panel className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Stock</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p, index) => (
                <tr key={p.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {p.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element -- arbitrary customer-hosted URLs cannot go through next/image
                        <img
                          src={p.imageUrl}
                          alt=""
                          className="h-9 w-9 shrink-0 rounded-md object-cover"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900">{p.name}</div>
                        {p.description && (
                          <div className="max-w-xs truncate text-xs text-slate-500">
                            {p.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">{p.sku ?? '—'}</td>
                  <td className="px-4 py-3">{p.category ?? '—'}</td>
                  <td className="px-4 py-3">{priceDisplay(p)}</td>
                  <td className="px-4 py-3">{p.stockQuantity ?? '—'}</td>
                  <td className="px-4 py-3">
                    {p.isActive ? (
                      <Badge color="green">Active</Badge>
                    ) : (
                      <Badge color="slate">Inactive</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {canReorder && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Move up"
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            ↑
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Move down"
                            disabled={index === items.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            ↓
                          </Button>
                        </>
                      )}
                      {!readOnly && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => toggleStatus(p)}
                          >
                            {p.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setEditing(p);
                              setModalOpen(true);
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setDeleting(p)}
                          >
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {pagination.page} of {pagination.totalPages} ({pagination.total}{' '}
            total)
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <ProductFormModal
        open={modalOpen}
        product={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          notify(editing ? 'Product updated' : 'Product created', 'success');
          load();
        }}
      />

      <ImportExcelModal
        open={importOpen}
        title="Import products from Excel"
        templateColumns={IMPORT_COLUMNS}
        onClose={() => setImportOpen(false)}
        onPreview={(file) => productsApi.importPreview(file)}
        onCommit={(file, mode) => productsApi.importCommit(file, mode)}
        onImported={load}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete product"
        message={`Delete "${deleting?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteLoading}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
