'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { documentsApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { useToast } from '@/components/toast';
import type { KnowledgeDocument } from '@/lib/types';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataList,
  EmptyState,
  SectionCard,
  Toggle,
  type DataListColumn,
} from '@/components/ui';

const MAX_FILES = 5;
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** READY / PROCESSING / FAILED as words a person can read (§8). */
function StatusBadge({ doc }: { doc: KnowledgeDocument }) {
  if (doc.status === 'READY') return <Badge color="green">Ready</Badge>;
  if (doc.status === 'PROCESSING')
    return <Badge color="amber">Processing</Badge>;
  return (
    <span title={doc.failureReason ?? undefined}>
      <Badge color="red">Failed</Badge>
    </span>
  );
}

/**
 * PDF knowledge documents: upload, replace, activate/deactivate, download,
 * delete. AGENT sees a read-only list.
 */
export function DocumentsPanel({ readOnly }: { readOnly: boolean }) {
  const { notify } = useToast();

  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeDocument | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<KnowledgeDocument | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await documentsApi.list();
      setDocs(res.documents);
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function validate(files: File[]): string | null {
    if (files.length === 0) return null;
    if (files.length > MAX_FILES)
      return `You can upload up to ${MAX_FILES} PDFs at once.`;
    for (const f of files) {
      if (f.size > MAX_SIZE_BYTES)
        return `"${f.name}" exceeds the 10 MB limit.`;
    }
    return null;
  }

  async function handleUpload(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    const problem = validate(files);
    if (problem) {
      notify(problem, 'error');
      return;
    }
    setUploading(true);
    try {
      const res = await documentsApi.upload(files);
      notify(
        `${res.documents.length} document${res.documents.length === 1 ? '' : 's'} uploaded — processing started`,
        'success',
      );
      await load();
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setUploading(false);
    }
  }

  async function handleReplace(fileList: FileList | null) {
    const target = replaceTargetRef.current;
    const file = fileList?.[0];
    replaceTargetRef.current = null;
    if (!target || !file) return;
    if (file.size > MAX_SIZE_BYTES) {
      notify(`"${file.name}" exceeds the 10 MB limit.`, 'error');
      return;
    }
    setBusyId(target.id);
    try {
      await documentsApi.replace(target.id, file);
      notify('Document replaced — processing started', 'success');
      await load();
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(doc: KnowledgeDocument) {
    setBusyId(doc.id);
    try {
      const { document } = await documentsApi.setStatus(doc.id, !doc.isActive);
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? document : d)));
      notify(
        document.isActive ? 'Document activated' : 'Document deactivated',
        'success',
      );
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function download(doc: KnowledgeDocument) {
    setBusyId(doc.id);
    try {
      await documentsApi.download(doc.id, doc.fileName);
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await documentsApi.remove(deleting.id);
      notify('Document deleted', 'success');
      setDeleting(null);
      await load();
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setDeleteLoading(false);
    }
  }

  const columns: DataListColumn<KnowledgeDocument>[] = [
    {
      key: 'file',
      header: 'File',
      primary: true,
      cell: (doc) => (
        <div className="min-w-0">
          <p
            className="break-words font-medium text-slate-900"
            title={doc.fileName}
          >
            {doc.fileName}
          </p>
          {doc.status === 'FAILED' && doc.failureReason && (
            <p className="mt-0.5 text-xs text-red-600">{doc.failureReason}</p>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (doc) => <StatusBadge doc={doc} />,
    },
    {
      key: 'size',
      header: 'Size',
      className: 'tabular-nums',
      cell: (doc) => formatSize(doc.sizeBytes),
    },
    {
      key: 'pages',
      header: 'Pages',
      className: 'tabular-nums',
      cell: (doc) => doc.pageCount ?? '—',
    },
    {
      key: 'chunks',
      header: 'Chunks',
      className: 'tabular-nums',
      cell: (doc) => doc.chunkCount,
    },
    {
      key: 'active',
      header: 'In use',
      cell: (doc) =>
        readOnly ? (
          doc.isActive ? (
            <Badge color="green">Active</Badge>
          ) : (
            <Badge color="slate">Inactive</Badge>
          )
        ) : (
          <span className="inline-flex items-center gap-2">
            <Toggle
              checked={doc.isActive}
              disabled={busyId === doc.id}
              label={`${doc.isActive ? 'Deactivate' : 'Activate'} ${doc.fileName}`}
              onChange={() => void toggleActive(doc)}
            />
            <span className="text-xs text-slate-500">
              {doc.isActive ? 'Active' : 'Inactive'}
            </span>
          </span>
        ),
    },
  ];

  return (
    <SectionCard
      title="PDF documents"
      description="Uploaded PDFs are split into searchable chunks the assistant can quote and cite."
      padded={false}
      actions={
        !readOnly ? (
          <Button
            loading={uploading}
            loadingLabel="Uploading…"
            onClick={() => uploadInputRef.current?.click()}
          >
            Upload PDFs
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4 p-4 sm:p-6">
        {/* Hidden pickers */}
        <input
          ref={uploadInputRef}
          type="file"
          accept=".pdf"
          multiple
          className="hidden"
          aria-label="Upload PDF documents"
          onChange={(e) => {
            void handleUpload(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={replaceInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          aria-label="Replace PDF document"
          onChange={(e) => {
            void handleReplace(e.target.files);
            e.target.value = '';
          }}
        />

        {error && (
          <Alert>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{error} The document list could not be loaded.</span>
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

        <DataList
          bare
          items={docs}
          loading={loading}
          skeletonRows={2}
          keyOf={(doc) => doc.id}
          columns={columns}
          caption="Knowledge base PDF documents"
          actions={(doc) => {
            const busy = busyId === doc.id;
            return (
              <>
                {!readOnly && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      replaceTargetRef.current = doc;
                      replaceInputRef.current?.click();
                    }}
                  >
                    Replace
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void download(doc)}
                >
                  Download
                </Button>
                {!readOnly && (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() => setDeleting(doc)}
                  >
                    Delete
                  </Button>
                )}
              </>
            );
          }}
          empty={
            <EmptyState
              title="No documents yet"
              description={
                readOnly
                  ? 'PDFs your team uploads will be listed here.'
                  : 'Upload up to 5 PDFs at a time (10 MB each) — price lists, policies, manuals — and the assistant can quote from them.'
              }
              action={
                !readOnly ? (
                  <Button onClick={() => uploadInputRef.current?.click()}>
                    Upload PDFs
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete document"
        message={`Delete "${deleting?.fileName}"? Its extracted chunks will no longer be available to the assistant. This cannot be undone.`}
        confirmLabel="Delete document"
        loading={deleteLoading}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </SectionCard>
  );
}
