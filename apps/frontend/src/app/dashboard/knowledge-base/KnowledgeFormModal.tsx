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
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert message={error} />}
        <div>
          <Label htmlFor="kb-title" required>
            Title
          </Label>
          <Input
            id="kb-title"
            value={title}
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
            onChange={(e) => setContent(e.target.value)}
            disabled={saving}
          />
          <FieldError message={fieldErrors.content} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="kb-cat">Category</Label>
            <Input
              id="kb-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={saving}
            />
          </div>
          <div>
            <Label htmlFor="kb-tags">Tags (comma separated)</Label>
            <Input
              id="kb-tags"
              value={tags}
              placeholder="returns, policy"
              onChange={(e) => setTags(e.target.value)}
              disabled={saving}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Toggle checked={isActive} onChange={setIsActive} label="Active" />
          <span className="text-sm text-slate-700">Active</span>
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {entry ? 'Save' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
