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
    <Modal
      open={open}
      onClose={onClose}
      title={faq ? 'Edit FAQ' : 'Add FAQ'}
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
          <Button type="submit" form="faq-form" loading={saving}>
            {faq ? 'Save changes' : 'Add FAQ'}
          </Button>
        </>
      }
    >
      <form id="faq-form" onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert message={error} />}
        <div>
          <Label htmlFor="faq-q" required>
            Question
          </Label>
          <Input
            id="faq-q"
            value={question}
            placeholder="Do you offer refunds?"
            invalid={Boolean(fieldErrors.question)}
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
            invalid={Boolean(fieldErrors.answer)}
            onChange={(e) => setAnswer(e.target.value)}
            disabled={saving}
          />
          <FieldError message={fieldErrors.answer} />
          <p className="mt-1 text-xs text-slate-500">
            The assistant reuses this wording, so write it as you would say it
            to a customer.
          </p>
        </div>
        <div>
          <Label htmlFor="faq-cat">Category</Label>
          <Input
            id="faq-cat"
            value={category}
            placeholder="Returns"
            invalid={Boolean(fieldErrors.category)}
            onChange={(e) => setCategory(e.target.value)}
            disabled={saving}
          />
          <FieldError message={fieldErrors.category} />
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
              Inactive FAQs are hidden from the assistant.
            </span>
          </span>
        </div>
      </form>
    </Modal>
  );
}
