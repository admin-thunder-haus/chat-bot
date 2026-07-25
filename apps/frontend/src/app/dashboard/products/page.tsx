'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  DataList,
  EmptyState,
  PageHeader,
  PaginationBar,
  Select,
  Toolbar,
  ToolbarSearch,
  type DataListColumn,
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
  const [activeFilter, setActiveFilter] = useState<'all' | 'true' | 'false'>(
    'all',
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const canReorder = !readOnly && !search && activeFilter === 'all';
  const filtered = Boolean(search) || activeFilter !== 'all';

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

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }

  // Row position by id — keeps the `cell`/`actions` renderers pure (they run
  // once for the table and once for the mobile cards).
  const rowIndex = useMemo(
    () => new Map(items.map((it, i) => [it.id, i])),
    [items],
  );

  const columns: DataListColumn<Product>[] = [
    {
      key: 'name',
      header: 'Product',
      primary: true,
      cell: (p) => (
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
              <div className="truncate text-xs text-slate-500 md:max-w-xs">
                {p.description}
              </div>
            )}
          </div>
        </div>
      ),
    },
    { key: 'sku', header: 'SKU', cell: (p) => p.sku ?? '—' },
    { key: 'category', header: 'Category', cell: (p) => p.category ?? '—' },
    {
      key: 'price',
      header: 'Price',
      className: 'tabular-nums',
      cell: (p) => priceDisplay(p),
    },
    {
      key: 'stock',
      header: 'Stock',
      className: 'tabular-nums',
      cell: (p) => p.stockQuantity ?? '—',
    },
    {
      key: 'status',
      header: 'Status',
      cell: (p) =>
        p.isActive ? (
          <Badge color="green">Active</Badge>
        ) : (
          <Badge color="slate">Inactive</Badge>
        ),
    },
  ];

  const hasActions = canReorder || !readOnly;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Products"
        description="Physical products your assistant can quote and recommend to customers."
        actions={
          !readOnly ? (
            <>
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                Import from Excel
              </Button>
              <Button onClick={openCreate}>Add product</Button>
            </>
          ) : undefined
        }
      />

      <div className="space-y-6">
        {error && (
          <Alert>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{error} The product list could not be loaded.</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void load()}
                className="sm:shrink-0"
              >
                Try again
              </Button>
            </div>
          </Alert>
        )}

        <div className="space-y-3">
          <Toolbar
            search={
              <ToolbarSearch
                value={search}
                label="Search products"
                placeholder="Search products…"
                onChange={(value) => {
                  setPage(1);
                  setSearch(value);
                }}
              />
            }
            filters={
              <>
                <label htmlFor="product-status" className="sr-only">
                  Filter by status
                </label>
                <Select
                  id="product-status"
                  value={activeFilter}
                  className="sm:max-w-[170px]"
                  onChange={(e) => {
                    setPage(1);
                    setActiveFilter(e.target.value as 'all' | 'true' | 'false');
                  }}
                >
                  <option value="all">All statuses</option>
                  <option value="true">Active only</option>
                  <option value="false">Inactive only</option>
                </Select>
              </>
            }
          />
          {canReorder && items.length > 1 && (
            <p className="text-xs text-slate-500">
              Use the arrows to change the order the assistant lists products
              in.
            </p>
          )}
        </div>

        <DataList
          items={items}
          loading={loading}
          keyOf={(p) => p.id}
          columns={columns}
          caption="Products"
          actions={
            hasActions
              ? (p) => {
                  const index = rowIndex.get(p.id) ?? 0;
                  return (
                    <>
                      {canReorder && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Move ${p.name} up`}
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            ↑
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Move ${p.name} down`}
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
                    </>
                  );
                }
              : undefined
          }
          empty={
            filtered ? (
              <EmptyState
                title="No matching products"
                description="No product matches this search and status. Try a different term or clear the filters."
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSearch('');
                      setActiveFilter('all');
                      setPage(1);
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="No products yet"
                description="Products are the catalogue your assistant quotes prices and stock from. Add the first one to get started."
                action={
                  !readOnly ? (
                    <Button onClick={openCreate}>Add product</Button>
                  ) : undefined
                }
              />
            )
          }
        />

        <PaginationBar
          page={pagination?.page ?? page}
          totalPages={pagination?.totalPages ?? 1}
          total={pagination?.total}
          onChange={setPage}
        />
      </div>

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
        message={`Delete "${deleting?.name}"? The assistant will stop quoting it. This cannot be undone.`}
        confirmLabel="Delete product"
        loading={deleteLoading}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
