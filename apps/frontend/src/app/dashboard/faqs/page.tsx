'use client';

import { useCallback, useEffect, useState } from 'react';
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
  EmptyState,
  Input,
  PageHeader,
  Panel,
  Skeleton,
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
        next.map((it, idx) => ({ id: it.id, sortOrder: (page - 1) * LIMIT + idx })),
      );
    } catch (err) {
      notify(parseApiError(err).message, 'error');
      load();
    }
  }

  return (
    <div>
      <PageHeader
        title="FAQs"
        description="Common questions and answers your assistant can reuse."
        actions={
          !readOnly ? (
            <Button
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              Add FAQ
            </Button>
          ) : undefined
        }
      />

      {error && (
        <div className="mb-4">
          <Alert message={error} />
        </div>
      )}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Search questions…"
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
          className="sm:max-w-xs"
        />
        <Input
          placeholder="Filter by category…"
          value={category}
          onChange={(e) => {
            setPage(1);
            setCategory(e.target.value);
          }}
          className="sm:max-w-xs"
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No FAQs yet"
          description={
            readOnly ? 'No FAQs have been added.' : 'Add your first FAQ.'
          }
          action={
            !readOnly ? (
              <Button
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
              >
                Add FAQ
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((f, index) => (
            <Panel key={f.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-slate-900">{f.question}</p>
                    {f.isActive ? (
                      <Badge color="green">Active</Badge>
                    ) : (
                      <Badge color="slate">Inactive</Badge>
                    )}
                    {f.category && <Badge color="blue">{f.category}</Badge>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                    {f.answer}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
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
                      <Button size="sm" variant="secondary" onClick={() => toggleStatus(f)}>
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
                      <Button size="sm" variant="danger" onClick={() => setDeleting(f)}>
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
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
        message="Delete this FAQ? This cannot be undone."
        confirmLabel="Delete"
        loading={deleteLoading}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
