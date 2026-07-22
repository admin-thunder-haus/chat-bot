'use client';

import { useCallback, useEffect, useState } from 'react';
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
  EmptyState,
  Input,
  PageHeader,
  Panel,
  Select,
  Skeleton,
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

const PRICE_TYPE_LABEL: Record<ServicePriceType, string> = {
  FIXED: 'Fixed',
  STARTING_FROM: 'From',
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
  const [activeFilter, setActiveFilter] = useState<'all' | 'true' | 'false'>('all');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [deleting, setDeleting] = useState<Service | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const canReorder = !readOnly && !search && activeFilter === 'all';

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

  return (
    <div>
      <PageHeader
        title="Services"
        description="Products and services your assistant can quote to customers."
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
                Add service
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
          placeholder="Search services…"
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
          title="No services yet"
          description={
            readOnly
              ? 'No services have been added.'
              : 'Add your first service so the assistant can share pricing.'
          }
          action={
            !readOnly ? (
              <Button
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
              >
                Add service
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
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s, index) => (
                <tr key={s.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
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
                          <div className="max-w-xs truncate text-xs text-slate-500">
                            {s.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">{priceDisplay(s)}</td>
                  <td className="px-4 py-3">
                    {s.durationMinutes ? `${s.durationMinutes} min` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {s.isActive ? (
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
        message={`Delete "${deleting?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteLoading}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
