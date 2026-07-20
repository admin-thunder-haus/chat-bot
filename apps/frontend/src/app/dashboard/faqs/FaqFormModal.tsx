'use client';

import { useEffect, useState } from 'react';
import { faqsApi, type FaqInput } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import type { Faq } from '@/lib/types';
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

export function FaqFormModal({
  open,
  faq,
  onClose,
  onSaved,
}: {
  open: boolean;
  faq: Faq | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [category, setCategory] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setFieldErrors({});
    setQuestion(faq?.question ?? '');
    setAnswer(faq?.answer ?? '');
    setCategory(faq?.category ?? '');
    setIsActive(faq?.isActive ?? true);
  }, [open, faq]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setFieldErrors({});
    if (!question.trim() || !answer.trim()) {
      setFieldErrors({
        question: !question.trim() ? 'Question is required' : '',
        answer: !answer.trim() ? 'Answer is required' : '',
      });
      return;
    }

    const payload: FaqInput = {
      question: question.trim(),
      answer: answer.trim(),
      category: category.trim() || null,
      isActive,
    };

    setSaving(true);
    try {
      if (faq) await faqsApi.update(faq.id, payload);
      else await faqsApi.create(payload);
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
    <Modal open={open} onClose={onClose} title={faq ? 'Edit FAQ' : 'Add FAQ'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert message={error} />}
        <div>
          <Label htmlFor="faq-q" required>
            Question
          </Label>
          <Input
            id="faq-q"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={saving}
          />
          <FieldError message={fieldErrors.question} />
        </div>
        <div>
          <Label htmlFor="faq-a" required>
            Answer
          </Label>
          <Textarea
            id="faq-a"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            disabled={saving}
          />
          <FieldError message={fieldErrors.answer} />
        </div>
        <div>
          <Label htmlFor="faq-cat">Category</Label>
          <Input
            id="faq-cat"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={saving}
          />
          <FieldError message={fieldErrors.category} />
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
            {faq ? 'Save' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
