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
  EmptyState,
  Skeleton,
  Toggle,
} from '@/components/ui';

const MAX_FILES = 5;
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusBadge({ doc }: { doc: KnowledgeDocument }) {
  if (doc.status === 'READY') return <Badge color="green">Ready</Badge>;
  if (doc.status === 'PROCESSING') return <Badge color="amber">Processing</Badge>;
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
    if (files.length > MAX_FILES) return `You can upload up to ${MAX_FILES} PDFs at once.`;
    for (const f of files) {
      if (f.size > MAX_SIZE_BYTES) return `"${f.name}" exceeds the 10 MB limit.`;
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
      notify(document.isActive ? 'Document activated' : 'Document deactivated', 'success');
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

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Documents (PDF)</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Uploaded PDFs are split into searchable chunks the assistant can cite.
          </p>
        </div>
        {!readOnly && (
          <Button
            loading={uploading}
            onClick={() => uploadInputRef.current?.click()}
          >
            Upload PDFs
          </Button>
        )}
      </div>

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
        <div className="mb-3">
          <Alert message={error} />
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : docs.length === 0 ? (
        <EmptyState
          title="No documents yet"
          description={
            readOnly
              ? 'No PDF documents have been uploaded.'
              : 'Upload up to 5 PDFs (max 10 MB each) to enrich the assistant.'
          }
          action={
            !readOnly ? (
              <Button onClick={() => uploadInputRef.current?.click()}>
                Upload PDFs
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {docs.map((doc) => {
            const busy = busyId === doc.id;
            return (
              <li key={doc.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {doc.fileName}
                    </p>
                    <StatusBadge doc={doc} />
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {formatSize(doc.sizeBytes)}
                    {doc.pageCount !== null && ` · ${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'}`}
                    {` · ${doc.chunkCount} chunk${doc.chunkCount === 1 ? '' : 's'}`}
                  </p>
                  {doc.status === 'FAILED' && doc.failureReason && (
                    <p className="mt-0.5 text-xs text-red-600">{doc.failureReason}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {!readOnly && (
                    <span className="mr-1 flex items-center gap-1.5">
                      <Toggle
                        checked={doc.isActive}
                        disabled={busy}
                        label={`${doc.isActive ? 'Deactivate' : 'Activate'} ${doc.fileName}`}
                        onChange={() => void toggleActive(doc)}
                      />
                      <span className="text-xs text-slate-500">
                        {doc.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </span>
                  )}
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
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete document"
        message={`Delete "${deleting?.fileName}"? Its extracted chunks will no longer be available to the assistant. This cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteLoading}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
