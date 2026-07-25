'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { canWrite } from '@/lib/permissions';
import { servicesApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { useToast } from '@/components/toast';
import type { Pagination, Service, ServicePriceType } from '@/lib/types';
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
import { ServiceFormModal } from './ServiceFormModal';

const IMPORT_COLUMNS = [
  'name',
  'description',
  'price',
  'currency',
  'priceType',
  'durationMinutes',
  'imageUrl',
  'isActive',
  'sortOrder',
];

/** Humanised price types — never show the raw enum to a user (§8). */
const PRICE_TYPE_LABEL: Record<ServicePriceType, string> = {
  FIXED: 'Fixed price',
  STARTING_FROM: 'Starting from',
  VARIABLE: 'Variable',
  CONTACT_US: 'Contact us',
  FREE: 'Free',
};

function priceDisplay(s: Service): string {
  if (s.price === null) return PRICE_TYPE_LABEL[s.priceType];
  const prefix = s.priceType === 'STARTING_FROM' ? 'From ' : '';
  return `${prefix}${s.price} ${s.currency}`;
}

const LIMIT = 10;

export default function ServicesPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const readOnly = !canWrite(user?.role);

  const [items, setItems] = useState<Service[]>([]);
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
  const [editing, setEditing] = useState<Service | null>(null);
  const [deleting, setDeleting] = useState<Service | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const canReorder = !readOnly && !search && activeFilter === 'all';
  const filtered = Boolean(search) || activeFilter !== 'all';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await servicesApi.list({
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

  async function toggleStatus(s: Service) {
    try {
      await servicesApi.setStatus(s.id, !s.isActive);
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
      await servicesApi.remove(deleting.id);
      notify('Service deleted', 'success');
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
      await servicesApi.reorder(
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

  const columns: DataListColumn<Service>[] = [
    {
      key: 'name',
      header: 'Service',
      primary: true,
      cell: (s) => (
        <div className="flex items-center gap-3">
          {s.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary customer-hosted URLs cannot go through next/image
            <img
              src={s.imageUrl}
              alt=""
              className="h-9 w-9 shrink-0 rounded-md object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
          <div className="min-w-0">
            <div className="font-medium text-slate-900">{s.name}</div>
            {s.description && (
              <div className="truncate text-xs text-slate-500 md:max-w-xs">
                {s.description}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      className: 'tabular-nums',
      cell: (s) => priceDisplay(s),
    },
    {
      key: 'duration',
      header: 'Duration',
      className: 'tabular-nums',
      cell: (s) => (s.durationMinutes ? `${s.durationMinutes} min` : '—'),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (s) =>
        s.isActive ? (
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
        title="Services"
        description="The services your assistant can describe, price and book for customers."
        actions={
          !readOnly ? (
            <>
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                Import from Excel
              </Button>
              <Button onClick={openCreate}>Add service</Button>
            </>
          ) : undefined
        }
      />

      <div className="space-y-6">
        {error && (
          <Alert>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{error} The service list could not be loaded.</span>
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
                label="Search services"
                placeholder="Search services…"
                onChange={(value) => {
                  setPage(1);
                  setSearch(value);
                }}
              />
            }
            filters={
              <>
                <label htmlFor="service-status" className="sr-only">
                  Filter by status
                </label>
                <Select
                  id="service-status"
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
              Use the arrows to change the order the assistant lists services
              in.
            </p>
          )}
        </div>

        <DataList
          items={items}
          loading={loading}
          keyOf={(s) => s.id}
          columns={columns}
          caption="Services"
          actions={
            hasActions
              ? (s) => {
                  const index = rowIndex.get(s.id) ?? 0;
                  return (
                    <>
                      {canReorder && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Move ${s.name} up`}
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            ↑
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Move ${s.name} down`}
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
                            onClick={() => toggleStatus(s)}
                          >
                            {s.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setEditing(s);
                              setModalOpen(true);
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setDeleting(s)}
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
                title="No matching services"
                description="No service matches this search and status. Try a different term or clear the filters."
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
                title="No services yet"
                description="Services tell the assistant what you offer and what it costs. Add the first one to get started."
                action={
                  !readOnly ? (
                    <Button onClick={openCreate}>Add service</Button>
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

      <ServiceFormModal
        open={modalOpen}
        service={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          notify(editing ? 'Service updated' : 'Service created', 'success');
          load();
        }}
      />

      <ImportExcelModal
        open={importOpen}
        title="Import services from Excel"
        templateColumns={IMPORT_COLUMNS}
        onClose={() => setImportOpen(false)}
        onPreview={(file) => servicesApi.importPreview(file)}
        onCommit={(file, mode) => servicesApi.importCommit(file, mode)}
        onImported={load}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete service"
        message={`Delete "${deleting?.name}"? The assistant will stop offering it. This cannot be undone.`}
        confirmLabel="Delete service"
        loading={deleteLoading}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
