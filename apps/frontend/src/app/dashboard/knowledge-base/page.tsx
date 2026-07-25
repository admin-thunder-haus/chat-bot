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
  DataList,
  EmptyState,
  Input,
  PageHeader,
  PaginationBar,
  Toolbar,
  ToolbarSearch,
  type DataListColumn,
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

  const filtered = Boolean(search) || Boolean(category);

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

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }

  const columns: DataListColumn<KnowledgeEntry>[] = [
    {
      key: 'title',
      header: 'Entry',
      primary: true,
      cell: (e) => (
        <div className="min-w-0">
          <div className="font-medium text-slate-900">{e.title}</div>
          <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
            {e.content}
          </p>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      cell: (e) =>
        e.category ? <Badge color="blue">{e.category}</Badge> : '—',
    },
    {
      key: 'tags',
      header: 'Tags',
      cell: (e) =>
        e.tags.length === 0 ? (
          '—'
        ) : (
          <div className="flex flex-wrap justify-end gap-1 md:justify-start">
            {e.tags.map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </div>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (e) =>
        e.isActive ? (
          <Badge color="green">Active</Badge>
        ) : (
          <Badge color="slate">Inactive</Badge>
        ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Knowledge base"
        description="Reference articles and PDFs the assistant draws answers from when nothing else matches."
        actions={
          !readOnly ? (
            <Button onClick={openCreate}>Add entry</Button>
          ) : undefined
        }
      />

      <div className="space-y-6">
        <DocumentsPanel readOnly={readOnly} />

        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Written entries
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Free-text articles you write and maintain here.
            </p>
          </div>

          {error && (
            <Alert>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span>{error} The entry list could not be loaded.</span>
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

          <Toolbar
            search={
              <ToolbarSearch
                value={search}
                label="Search entries"
                placeholder="Search title and content…"
                onChange={(value) => {
                  setPage(1);
                  setSearch(value);
                }}
              />
            }
            filters={
              <>
                <label htmlFor="kb-category-filter" className="sr-only">
                  Filter by category
                </label>
                <Input
                  id="kb-category-filter"
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

          <DataList
            items={items}
            loading={loading}
            keyOf={(e) => e.id}
            columns={columns}
            caption="Knowledge base entries"
            actions={
              !readOnly
                ? (e) => (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => toggleStatus(e)}
                      >
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
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setDeleting(e)}
                      >
                        Delete
                      </Button>
                    </>
                  )
                : undefined
            }
            empty={
              filtered ? (
                <EmptyState
                  title="No matching entries"
                  description="No entry matches this search and category. Try a different term or clear the filters."
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
                  title="No entries yet"
                  description="Entries are your own reference articles — policies, how-tos, anything the assistant should know. Add the first one to get started."
                  action={
                    !readOnly ? (
                      <Button onClick={openCreate}>Add entry</Button>
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
      </div>

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
        message={`Delete "${deleting?.title}"? The assistant will stop using it. This cannot be undone.`}
        confirmLabel="Delete entry"
        loading={deleteLoading}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
