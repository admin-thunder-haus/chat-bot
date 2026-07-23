'use client';

import { useRef, useState } from 'react';
import { imagesApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { Button, FieldError, Label } from '@/components/ui';

const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp,image/gif';
const MAX_SIZE_BYTES = 2 * 1024 * 1024;

/**
 * Image picker that uploads the chosen file to the backend and yields its
 * public URL. Value is the URL string (or null) — the same field the Excel
 * import fills, so forms and imports stay interchangeable.
 */
export function ImageUploadField({
  label = 'Image',
  value,
  onChange,
  disabled = false,
}: {
  label?: string;
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [broken, setBroken] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError('');

    if (file.size > MAX_SIZE_BYTES) {
      setError('Image is too large (max 2 MB).');
      return;
    }

    setUploading(true);
    try {
      const image = await imagesApi.upload(file);
      setBroken(false);
      onChange(image.url);
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setUploading(false);
      // Allow re-selecting the same file after an error.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const inputId = `image-upload-${label.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <div>
      <Label htmlFor={inputId}>{label}</Label>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
        disabled={disabled || uploading}
      />

      <div className="mt-1 flex items-center gap-3">
        {value && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element -- backend-hosted upload URLs cannot go through next/image
          <img
            src={value}
            alt="Preview"
            className="h-16 w-16 rounded-md border border-slate-200 object-cover"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-slate-300 text-xs text-slate-400">
            No image
          </div>
        )}

        <div className="flex flex-col gap-1">
          <Button
            type="button"
            variant="secondary"
            loading={uploading}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            {value ? 'Replace image' : 'Upload image'}
          </Button>
          {value && (
            <button
              type="button"
              className="text-left text-xs text-red-600 underline disabled:text-slate-400"
              onClick={() => {
                onChange(null);
                setBroken(false);
              }}
              disabled={disabled || uploading}
            >
              Remove image
            </button>
          )}
        </div>
      </div>

      <p className="mt-1 text-xs text-slate-400">
        PNG, JPEG, WebP or GIF — up to 2 MB.
      </p>
      <FieldError message={error} />
    </div>
  );
}
