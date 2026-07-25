'use client';

import { useEffect, useState } from 'react';
import { knowledgeApi, type KnowledgeInput } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import type { KnowledgeEntry } from '@/lib/types';
import {
  Alert,
  Button,
  FieldError,
  Input,
  Label,
  Modal,
  Textarea,
  Toggle,
} from '@/components/ui';

function parseTags(input: string): string[] {
  return input
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export function KnowledgeFormModal({
  open,
  entry,
  onClose,
  onSaved,
}: {
  open: boolean;
  entry: KnowledgeEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setFieldErrors({});
    setTitle(entry?.title ?? '');
    setContent(entry?.content ?? '');
    setCategory(entry?.category ?? '');
    setTags(entry?.tags.join(', ') ?? '');
    setIsActive(entry?.isActive ?? true);
  }, [open, entry]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setFieldErrors({});
    if (!title.trim() || !content.trim()) {
      setFieldErrors({
        title: !title.trim() ? 'Title is required' : '',
        content: !content.trim() ? 'Content is required' : '',
      });
      return;
    }

    const payload: KnowledgeInput = {
      title: title.trim(),
      content: content.trim(),
      category: category.trim() || null,
      tags: parseTags(tags),
      isActive,
    };

    setSaving(true);
    try {
      if (entry) await knowledgeApi.update(entry.id, payload);
      else await knowledgeApi.create(payload);
      onSaved();
    } catch (err) {
      const parsed = parseApiError(err);
      setError(parsed.message);
      setFieldErrors(parsed.fieldErrors);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={entry ? 'Edit entry' : 'Add knowledge entry'}
      footer={
        <>
          <Button
            variant="secondary"
            type="button"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" form="knowledge-form" loading={saving}>
            {entry ? 'Save changes' : 'Add entry'}
          </Button>
        </>
      }
    >
      <form id="knowledge-form" onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert message={error} />}
        <div>
          <Label htmlFor="kb-title" required>
            Title
          </Label>
          <Input
            id="kb-title"
            value={title}
            placeholder="Refund policy"
            invalid={Boolean(fieldErrors.title)}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving}
          />
          <FieldError message={fieldErrors.title} />
        </div>
        <div>
          <Label htmlFor="kb-content" required>
            Content
          </Label>
          <Textarea
            id="kb-content"
            className="min-h-[160px]"
            value={content}
            invalid={Boolean(fieldErrors.content)}
            onChange={(e) => setContent(e.target.value)}
            disabled={saving}
          />
          <FieldError message={fieldErrors.content} />
          <p className="mt-1 text-xs text-slate-500">
            Plain text. The assistant searches this content and quotes the
            relevant part.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="kb-cat">Category</Label>
            <Input
              id="kb-cat"
              value={category}
              placeholder="Policies"
              invalid={Boolean(fieldErrors.category)}
              onChange={(e) => setCategory(e.target.value)}
              disabled={saving}
            />
            <FieldError message={fieldErrors.category} />
          </div>
          <div>
            <Label htmlFor="kb-tags">Tags</Label>
            <Input
              id="kb-tags"
              value={tags}
              placeholder="returns, policy"
              invalid={Boolean(fieldErrors.tags)}
              onChange={(e) => setTags(e.target.value)}
              disabled={saving}
            />
            <FieldError message={fieldErrors.tags} />
            <p className="mt-1 text-xs text-slate-500">Separate with commas.</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Toggle
            checked={isActive}
            onChange={setIsActive}
            disabled={saving}
            label="Active"
          />
          <span className="text-sm text-slate-700">
            Active
            <span className="block text-xs text-slate-500">
              Inactive entries are hidden from the assistant.
            </span>
          </span>
        </div>
      </form>
    </Modal>
  );
}
