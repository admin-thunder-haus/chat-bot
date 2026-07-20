'use client';

import { useState } from 'react';
import { aiApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import type { AIGenerationResult, ReplyTone } from '@/lib/types';
import { Alert, Button, Label, Select, Textarea } from '@/components/ui';

const TONES: ReplyTone[] = ['PROFESSIONAL', 'FRIENDLY', 'CASUAL', 'FORMAL', 'CONCISE'];

export function AIPlaygroundForm({
  onResult,
  onBusyChange,
}: {
  onResult: (result: AIGenerationResult) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [question, setQuestion] = useState('');
  const [tone, setTone] = useState<'' | ReplyTone>('');
  const [language, setLanguage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setError('');
    setBusy(true);
    onBusyChange(true);
    try {
      const result = await aiApi.playground({
        question: question.trim(),
        tone: tone || undefined,
        language: language.trim() || undefined,
      });
      onResult(result);
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert message={error} />}
      <div>
        <Label htmlFor="pg-question" required>
          Test customer question
        </Label>
        <Textarea
          id="pg-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. What are your prices and opening hours?"
          className="min-h-[100px]"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="pg-tone">Tone override (optional)</Label>
          <Select
            id="pg-tone"
            value={tone}
            onChange={(e) => setTone(e.target.value as '' | ReplyTone)}
          >
            <option value="">Use company default</option>
            {TONES.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0) + t.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="pg-lang">Language override (optional)</Label>
          <Select
            id="pg-lang"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="">Use company default</option>
            <option value="auto">Auto (match customer)</option>
            <option value="en">English</option>
            <option value="ar">Arabic</option>
          </Select>
        </div>
      </div>
      <Button type="submit" loading={busy} disabled={!question.trim()}>
        Generate test response
      </Button>
    </form>
  );
}
