'use client';

import { useEffect, useState } from 'react';
import { parseApiError } from '@/lib/form';
import { useToast } from '@/components/toast';
import type { ImportPreview, ImportResult, ImportRowResult } from '@/lib/types';
import { Alert, Badge, Button, Modal } from '@/components/ui';

type ImportMode = 'merge' | 'replace';

/** Normalize a template column label the way the backend normalizes headers. */
function rawKey(column: string): string {
  return column.toLowerCase().replace(/[\s_-]/g, '');
}

function cellText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

/**
 * Generic Excel (.xlsx) import dialog shared by services and products: pick a
 * file, preview parsed rows with validation errors, then commit in merge or
 * replace mode.
 */
export function ImportExcelModal({
  open,
  title,
  templateColumns,
  onClose,
  onPreview,
  onCommit,
  onImported,
}: {
  open: boolean;
  title: string;
  templateColumns: string[];
  onClose: () => void;
  onPreview: (file: File) => Promise<ImportPreview>;
  onCommit: (file: File, mode: ImportMode) => Promise<ImportResult>;
  onImported: () => void;
}) {
  const { notify } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setPreview(null);
    setMode('merge');
    setReplaceConfirmed(false);
    setPreviewLoading(false);
    setImporting(false);
    setError('');
  }, [open]);

  function onFileChange(next: File | null) {
    setFile(next);
    // A new file invalidates any previous preview.
    setPreview(null);
    setError('');
  }

  async function generatePreview() {
    if (!file) return;
    setPreviewLoading(true);
    setError('');
    try {
      setPreview(await onPreview(file));
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function runImport() {
    if (!file || !preview) return;
    setImporting(true);
    setError('');
    try {
      const result = await onCommit(file, mode);
      notify(
        `Imported ${result.total} row${result.total === 1 ? '' : 's'} (${result.created} created, ${result.updated} updated${
          result.deleted > 0 ? `, ${result.deleted} deleted` : ''
        })`,
        'success',
      );
      onImported();
      onClose();
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setImporting(false);
    }
  }

  const summary = preview?.summary;
  const hasInvalid = (summary?.invalidRows ?? 0) > 0;
  const importDisabled =
    !preview || hasInvalid || (mode === 'replace' && !replaceConfirmed);

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        {error && <Alert message={error} />}

        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">
            Excel file (.xlsx)
          </p>
          <input
            type="file"
            accept=".xlsx"
            disabled={previewLoading || importing}
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-slate-700"
          />
          <p className="mt-1 text-xs text-slate-500">
            Expected columns: {templateColumns.join(', ')}
          </p>
        </div>

        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!file}
            loading={previewLoading}
            onClick={generatePreview}
          >
            Generate preview
          </Button>
        </div>

        {preview && summary && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge color="slate">{summary.totalRows} total</Badge>
              <Badge color="green">{summary.validRows} valid</Badge>
              <Badge color={summary.invalidRows > 0 ? 'red' : 'slate'}>
                {summary.invalidRows} invalid
              </Badge>
            </div>

            <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-left uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-2 py-2">#</th>
                    {templateColumns.map((col) => (
                      <th key={col} className="whitespace-nowrap px-2 py-2">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row: ImportRowResult) => (
                    <tr
                      key={row.rowNumber}
                      className={`border-b border-slate-100 last:border-0 ${
                        row.errors.length > 0 ? 'bg-red-50/50' : ''
                      }`}
                    >
                      <td className="px-2 py-1.5 text-slate-400">
                        {row.rowNumber}
                      </td>
                      {templateColumns.map((col) => (
                        <td
                          key={col}
                          className="max-w-[160px] truncate px-2 py-1.5 text-slate-700"
                        >
                          {cellText(row.raw[rawKey(col)])}
                          {col === templateColumns[0] &&
                            row.errors.length > 0 && (
                              <div className="whitespace-normal text-[11px] text-red-600">
                                {row.errors
                                  .map((e) =>
                                    e.field
                                      ? `${e.field}: ${e.message}`
                                      : e.message,
                                  )
                                  .join('; ')}
                              </div>
                            )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hasInvalid && (
              <Alert
                variant="warning"
                message="Fix the invalid rows in the file and generate the preview again before importing."
              />
            )}

            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium text-slate-700">
                Import mode
              </legend>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name="import-mode"
                  className="mt-0.5"
                  checked={mode === 'merge'}
                  disabled={importing}
                  onChange={() => setMode('merge')}
                />
                <span>Add &amp; update existing</span>
              </label>
              <label className="flex items-start gap-2 text-sm text-red-700">
                <input
                  type="radio"
                  name="import-mode"
                  className="mt-0.5"
                  checked={mode === 'replace'}
                  disabled={importing}
                  onChange={() => setMode('replace')}
                />
                <span className="font-medium">
                  Replace ALL existing entries
                </span>
              </label>
              {mode === 'replace' && (
                <label className="ml-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={replaceConfirmed}
                    disabled={importing}
                    onChange={(e) => setReplaceConfirmed(e.target.checked)}
                  />
                  <span>
                    I understand this deletes all existing records first.
                  </span>
                </label>
              )}
            </fieldset>
          </>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <Button
            variant="secondary"
            type="button"
            onClick={onClose}
            disabled={importing}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={mode === 'replace' ? 'danger' : 'primary'}
            disabled={importDisabled}
            loading={importing}
            onClick={runImport}
          >
            Import
          </Button>
        </div>
      </div>
    </Modal>
  );
}
