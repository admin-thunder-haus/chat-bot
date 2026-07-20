'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { canWrite } from '@/lib/permissions';
import { aiSettingsApi, type AISettingsInput } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { useToast } from '@/components/toast';
import { AIUsageSummary } from '@/components/ai/AIUsageSummary';
import type { AISettings, ReplyTone } from '@/lib/types';
import {
  Alert,
  Button,
  ConfirmDialog,
  FieldError,
  Input,
  Label,
  PageHeader,
  Panel,
  Select,
  Skeleton,
  Textarea,
  Toggle,
} from '@/components/ui';

const TONES: ReplyTone[] = [
  'PROFESSIONAL',
  'FRIENDLY',
  'CASUAL',
  'FORMAL',
  'CONCISE',
];

export default function AISettingsPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const readOnly = !canWrite(user?.role);

  const [settings, setSettings] = useState<AISettings | null>(null);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmAutoReply, setConfirmAutoReply] = useState(false);

  useEffect(() => {
    let active = true;
    aiSettingsApi
      .get()
      .then(({ settings }) => active && setSettings(settings))
      .catch((err) => active && setError(parseApiError(err).message));
    return () => {
      active = false;
    };
  }, []);

  function update<K extends keyof AISettings>(key: K, value: AISettings[K]) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setError('');
    setFieldErrors({});

    const payload: AISettingsInput = {
      assistantName: settings.assistantName?.trim() || null,
      systemInstructions: settings.systemInstructions?.trim() || null,
      replyTone: settings.replyTone,
      preferredLanguage: settings.preferredLanguage,
      fallbackMessage: settings.fallbackMessage,
      humanHandoffMessage: settings.humanHandoffMessage,
      maxReplyLength: settings.maxReplyLength,
      useEmojis: settings.useEmojis,
      autoReplyEnabled: settings.autoReplyEnabled,
    };

    setSaving(true);
    try {
      const { settings: saved } = await aiSettingsApi.save(payload);
      setSettings(saved);
      notify('AI settings saved', 'success');
    } catch (err) {
      const parsed = parseApiError(err);
      setError(parsed.message);
      setFieldErrors(parsed.fieldErrors);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="AI Settings"
        description="Configure how your future assistant will behave."
        actions={
          !readOnly && settings ? (
            <Button type="submit" form="ai-form" loading={saving}>
              Save settings
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Alert variant="info">
          AI drafts and replies are powered by these settings. Test them safely
          in the{' '}
          <Link href="/dashboard/ai-playground" className="font-medium underline">
            AI Playground
          </Link>
          . Real social channels (WhatsApp, Instagram, etc.) are still not
          connected. Enabling automatic replies requires opt-in below.
        </Alert>
      </div>

      <div className="mb-6">
        <AIUsageSummary />
      </div>

      {readOnly && (
        <div className="mb-4">
          <Alert variant="info" message="You have read-only access to this page." />
        </div>
      )}
      {error && (
        <div className="mb-4">
          <Alert message={error} />
        </div>
      )}

      {!settings ? (
        <Panel>
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        </Panel>
      ) : (
        <form id="ai-form" onSubmit={handleSubmit}>
          <Panel className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="ai-name">Assistant name</Label>
                <Input
                  id="ai-name"
                  value={settings.assistantName ?? ''}
                  disabled={readOnly || saving}
                  onChange={(e) => update('assistantName', e.target.value)}
                />
                <FieldError message={fieldErrors.assistantName} />
              </div>
              <div>
                <Label htmlFor="ai-tone">Reply tone</Label>
                <Select
                  id="ai-tone"
                  value={settings.replyTone}
                  disabled={readOnly || saving}
                  onChange={(e) => update('replyTone', e.target.value as ReplyTone)}
                >
                  {TONES.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0) + t.slice(1).toLowerCase()}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="ai-lang">Preferred language</Label>
                <Input
                  id="ai-lang"
                  value={settings.preferredLanguage}
                  placeholder="ar / en / auto"
                  disabled={readOnly || saving}
                  onChange={(e) => update('preferredLanguage', e.target.value)}
                />
                <FieldError message={fieldErrors.preferredLanguage} />
              </div>
              <div>
                <Label htmlFor="ai-max">Maximum reply length</Label>
                <Input
                  id="ai-max"
                  type="number"
                  min="50"
                  max="4000"
                  value={settings.maxReplyLength ?? ''}
                  disabled={readOnly || saving}
                  onChange={(e) =>
                    update(
                      'maxReplyLength',
                      e.target.value === '' ? null : Number(e.target.value),
                    )
                  }
                />
                <FieldError message={fieldErrors.maxReplyLength} />
              </div>
            </div>

            <div>
              <Label htmlFor="ai-sys">System instructions</Label>
              <Textarea
                id="ai-sys"
                className="min-h-[120px]"
                value={settings.systemInstructions ?? ''}
                disabled={readOnly || saving}
                onChange={(e) => update('systemInstructions', e.target.value)}
              />
              <FieldError message={fieldErrors.systemInstructions} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="ai-fallback">Fallback message</Label>
                <Textarea
                  id="ai-fallback"
                  value={settings.fallbackMessage}
                  disabled={readOnly || saving}
                  onChange={(e) => update('fallbackMessage', e.target.value)}
                />
                <FieldError message={fieldErrors.fallbackMessage} />
              </div>
              <div>
                <Label htmlFor="ai-handoff">Human handoff message</Label>
                <Textarea
                  id="ai-handoff"
                  value={settings.humanHandoffMessage}
                  disabled={readOnly || saving}
                  onChange={(e) => update('humanHandoffMessage', e.target.value)}
                />
                <FieldError message={fieldErrors.humanHandoffMessage} />
              </div>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
              <div className="flex items-center gap-3">
                <Toggle
                  checked={settings.useEmojis}
                  disabled={readOnly || saving}
                  onChange={(v) => update('useEmojis', v)}
                  label="Use emojis"
                />
                <span className="text-sm text-slate-700">Use emojis</span>
              </div>
              <div className="flex items-center gap-3">
                <Toggle
                  checked={settings.autoReplyEnabled}
                  disabled={readOnly || saving}
                  onChange={(v) => {
                    // Confirm before turning auto-reply ON.
                    if (v) setConfirmAutoReply(true);
                    else update('autoReplyEnabled', false);
                  }}
                  label="Auto-reply enabled"
                />
                <span className="text-sm text-slate-700">
                  Auto-reply enabled{' '}
                  <span className="text-slate-400">
                    (AI answers new inbound messages automatically)
                  </span>
                </span>
              </div>
            </div>
          </Panel>
        </form>
      )}

      <ConfirmDialog
        open={confirmAutoReply}
        title="Enable automatic AI replies?"
        message="When enabled, the AI will automatically reply to new inbound (mock) customer messages using your company knowledge. You can pause AI per conversation at any time. Continue?"
        confirmLabel="Enable auto-reply"
        onConfirm={() => {
          update('autoReplyEnabled', true);
          setConfirmAutoReply(false);
        }}
        onCancel={() => setConfirmAutoReply(false)}
      />
    </div>
  );
}
