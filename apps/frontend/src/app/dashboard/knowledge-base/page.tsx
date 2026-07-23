'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { canWrite } from '@/lib/permissions';
import { knowledgeApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { useToast } from '@/components/toast';
import type { KnowledgeEntry, Pagination } from '@/lib/types';
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
import { KnowledgeFormModal } from './KnowledgeFormModal';
import { DocumentsPanel } from './DocumentsPanel';

const LIMIT = 10;

export default function KnowledgeBasePage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const readOnly = !canWrite(user?.role);

  const [items, setItems] = useState<KnowledgeEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeEntry | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeEntry | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await knowledgeApi.list({
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

  async function toggleStatus(e: KnowledgeEntry) {
    try {
      await knowledgeApi.setStatus(e.id, !e.isActive);
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
      await knowledgeApi.remove(deleting.id);
      notify('Entry deleted', 'success');
      setDeleting(null);
      load();
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Knowledge Base"
        description="Reference articles the assistant can draw answers from."
        actions={
          !readOnly ? (
            <Button
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              Add entry
            </Button>
          ) : undefined
        }
      />

      {error && (
        <div className="mb-4">
          <Alert message={error} />
        </div>
      )}

      <div className="mb-6">
        <DocumentsPanel readOnly={readOnly} />
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Search title & content…"
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
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No entries yet"
          description={
            readOnly ? 'No knowledge entries have been added.' : 'Add your first entry.'
          }
          action={
            !readOnly ? (
              <Button
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
              >
                Add entry
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((e) => (
            <Panel key={e.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-900">{e.title}</p>
                    {e.isActive ? (
                      <Badge color="green">Active</Badge>
                    ) : (
                      <Badge color="slate">Inactive</Badge>
                    )}
                    {e.category && <Badge color="blue">{e.category}</Badge>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                    {e.content}
                  </p>
                  {e.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {e.tags.map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                {!readOnly && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="secondary" onClick={() => toggleStatus(e)}>
                      {e.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEditing(e);
                        setModalOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => setDeleting(e)}>
                      Delete
                    </Button>
                  </div>
                )}
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

      <KnowledgeFormModal
        open={modalOpen}
        entry={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          notify(editing ? 'Entry updated' : 'Entry created', 'success');
          load();
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete entry"
        message={`Delete "${deleting?.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteLoading}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
