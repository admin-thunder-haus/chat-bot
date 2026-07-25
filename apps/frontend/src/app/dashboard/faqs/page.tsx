'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { canWrite } from '@/lib/permissions';
import { faqsApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { useToast } from '@/components/toast';
import type { Faq, Pagination } from '@/lib/types';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataList,
  EmptyState,
  Input,
  PageHeader,
  PaginationBar,
  Toolbar,
  ToolbarSearch,
  type DataListColumn,
} from '@/components/ui';
import { FaqFormModal } from './FaqFormModal';

const LIMIT = 10;

export default function FaqsPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const readOnly = !canWrite(user?.role);

  const [items, setItems] = useState<Faq[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Faq | null>(null);
  const [deleting, setDeleting] = useState<Faq | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const canReorder = !readOnly && !search && !category;
  const filtered = Boolean(search) || Boolean(category);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await faqsApi.list({
        page,
        limit: LIMIT,
        search: search || undefined,
        category: category || undefined,
      });
      setItems(res.items);
      setPagination(res.pagination);
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [page, search, category]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  async function toggleStatus(f: Faq) {
    try {
      await faqsApi.setStatus(f.id, !f.isActive);
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
      await faqsApi.remove(deleting.id);
      notify('FAQ deleted', 'success');
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
      await faqsApi.reorder(
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

  const columns: DataListColumn<Faq>[] = [
    {
      key: 'question',
      header: 'Question',
      primary: true,
      cell: (f) => (
        <div className="min-w-0">
          <div className="font-medium text-slate-900">{f.question}</div>
          <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
            {f.answer}
          </p>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      cell: (f) =>
        f.category ? <Badge color="blue">{f.category}</Badge> : '—',
    },
    {
      key: 'status',
      header: 'Status',
      cell: (f) =>
        f.isActive ? (
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
        title="FAQs"
        description="Question-and-answer pairs the assistant reuses word-for-word when a customer asks."
        actions={
          !readOnly ? <Button onClick={openCreate}>Add FAQ</Button> : undefined
        }
      />

      <div className="space-y-6">
        {error && (
          <Alert>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{error} The FAQ list could not be loaded.</span>
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
                label="Search questions"
                placeholder="Search questions…"
                onChange={(value) => {
                  setPage(1);
                  setSearch(value);
                }}
              />
            }
            filters={
              <>
                <label htmlFor="faq-category" className="sr-only">
                  Filter by category
                </label>
                <Input
                  id="faq-category"
                  value={category}
                  placeholder="Filter by category…"
                  className="sm:max-w-[14rem]"
                  onChange={(e) => {
                    setPage(1);
                    setCategory(e.target.value);
                  }}
                />
              </>
            }
          />
          {canReorder && items.length > 1 && (
            <p className="text-xs text-slate-500">
              Use the arrows to change the order the assistant considers FAQs
              in.
            </p>
          )}
        </div>

        <DataList
          items={items}
          loading={loading}
          keyOf={(f) => f.id}
          columns={columns}
          caption="FAQs"
          actions={
            hasActions
              ? (f) => {
                  const index = rowIndex.get(f.id) ?? 0;
                  return (
                    <>
                      {canReorder && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Move this FAQ up"
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            ↑
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Move this FAQ down"
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
                            onClick={() => toggleStatus(f)}
                          >
                            {f.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setEditing(f);
                              setModalOpen(true);
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setDeleting(f)}
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
                title="No matching FAQs"
                description="No FAQ matches this search and category. Try a different term or clear the filters."
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSearch('');
                      setCategory('');
                      setPage(1);
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="No FAQs yet"
                description="FAQs give the assistant your exact wording for the questions customers ask most. Add the first one to get started."
                action={
                  !readOnly ? (
                    <Button onClick={openCreate}>Add FAQ</Button>
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

      <FaqFormModal
        open={modalOpen}
        faq={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          notify(editing ? 'FAQ updated' : 'FAQ created', 'success');
          load();
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete FAQ"
        message={`Delete "${deleting?.question}"? The assistant will stop using this answer. This cannot be undone.`}
        confirmLabel="Delete FAQ"
        loading={deleteLoading}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
