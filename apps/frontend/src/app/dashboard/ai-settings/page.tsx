'use client';

import { useCallback, useEffect, useState } from 'react';
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
  Badge,
  Button,
  ConfirmDialog,
  FieldError,
  Input,
  Label,
  PageHeader,
  SectionCard,
  Select,
  Skeleton,
  Textarea,
  Toggle,
} from '@/components/ui';

/** Humanised tones — never show the raw enum to a user (§8). */
const TONES: { value: ReplyTone; label: string }[] = [
  { value: 'PROFESSIONAL', label: 'Professional' },
  { value: 'FRIENDLY', label: 'Friendly' },
  { value: 'CASUAL', label: 'Casual' },
  { value: 'FORMAL', label: 'Formal' },
  { value: 'CONCISE', label: 'Concise' },
];

const MAX_KEYWORDS = 50;

/** Comma-separated text → trimmed, de-duplicated keyword list (max 50). */
function parseKeywords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(',')) {
    const kw = raw.trim();
    if (!kw || seen.has(kw.toLowerCase())) continue;
    seen.add(kw.toLowerCase());
    out.push(kw);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

/** A labelled on/off row — the same shape for every switch on this page. */
function ToggleRow({
  checked,
  onChange,
  disabled,
  label,
  description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Toggle
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        label={label}
      />
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800">{label}</p>
        <p className="mt-0.5 text-xs text-slate-500">{description}</p>
      </div>
    </div>
  );
}

export default function AISettingsPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const readOnly = !canWrite(user?.role);

  const [settings, setSettings] = useState<AISettings | null>(null);
  const [keywordsText, setKeywordsText] = useState('');
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmAutoReply, setConfirmAutoReply] = useState(false);

  const load = useCallback(async () => {
    setError('');
    setLoadFailed(false);
    try {
      const { settings: loaded } = await aiSettingsApi.get();
      setSettings(loaded);
      setKeywordsText((loaded.handoffKeywords ?? []).join(', '));
    } catch (err) {
      setError(parseApiError(err).message);
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      handoffOnRequest: settings.handoffOnRequest,
      handoffOnLowConfidence: settings.handoffOnLowConfidence,
      handoffKeywords: parseKeywords(keywordsText),
      welcomeEnabled: settings.welcomeEnabled,
      // Empty string is meaningful here: it clears the override and restores
      // the built-in greeting, rather than sending an empty welcome.
      welcomeMessage: settings.welcomeMessage?.trim() || null,
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

  const saveButton = (
    <Button
      type="submit"
      form="ai-form"
      loading={saving}
      loadingLabel="Saving…"
    >
      Save settings
    </Button>
  );

  const keywords = parseKeywords(keywordsText);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="AI settings"
        description="How your assistant writes, which language it uses, and when it hands a conversation to your team."
        actions={
          !readOnly && settings ? (
            // On phones the sticky bar at the end of the form carries Save.
            <span className="hidden sm:block">{saveButton}</span>
          ) : undefined
        }
      />

      <div className="space-y-6">
        <Alert variant="info">
          These settings drive every AI draft and reply. Try them safely in the{' '}
          <Link
            href="/dashboard/ai-playground"
            className="font-medium underline"
          >
            AI playground
          </Link>{' '}
          before turning automatic replies on.
        </Alert>

        <AIUsageSummary />

        {readOnly && (
          <Alert
            variant="info"
            message="You have read-only access to this page. Ask an owner or admin to make changes."
          />
        )}
        {error && (
          <Alert>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{error}</span>
              {loadFailed && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void load()}
                  className="sm:shrink-0"
                >
                  Try again
                </Button>
              )}
            </div>
          </Alert>
        )}

        {!settings ? (
          loadFailed ? null : (
            <>
              <Skeleton className="h-64 rounded-xl" />
              <Skeleton className="h-56 rounded-xl" />
              <Skeleton className="h-56 rounded-xl" />
            </>
          )
        ) : (
          <form id="ai-form" onSubmit={handleSubmit} className="space-y-6">
            <SectionCard
              title="Voice"
              description="The name and tone customers experience."
            >
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="ai-name">Assistant name</Label>
                    <Input
                      id="ai-name"
                      value={settings.assistantName ?? ''}
                      placeholder="Support"
                      disabled={readOnly || saving}
                      invalid={Boolean(fieldErrors.assistantName)}
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
                      onChange={(e) =>
                        update('replyTone', e.target.value as ReplyTone)
                      }
                    >
                      {TONES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="ai-lang">Preferred language</Label>
                    <Input
                      id="ai-lang"
                      value={settings.preferredLanguage}
                      placeholder="auto"
                      disabled={readOnly || saving}
                      invalid={Boolean(fieldErrors.preferredLanguage)}
                      onChange={(e) =>
                        update('preferredLanguage', e.target.value)
                      }
                    />
                    <FieldError message={fieldErrors.preferredLanguage} />
                    {!fieldErrors.preferredLanguage && (
                      <p className="mt-1 text-xs text-slate-500">
                        ar, en, or auto to match the customer.
                      </p>
                    )}
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
                      invalid={Boolean(fieldErrors.maxReplyLength)}
                      onChange={(e) =>
                        update(
                          'maxReplyLength',
                          e.target.value === '' ? null : Number(e.target.value),
                        )
                      }
                    />
                    <FieldError message={fieldErrors.maxReplyLength} />
                    {!fieldErrors.maxReplyLength && (
                      <p className="mt-1 text-xs text-slate-500">
                        Characters, between 50 and 4000.
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <Label htmlFor="ai-sys">System instructions</Label>
                  <Textarea
                    id="ai-sys"
                    className="min-h-[120px]"
                    value={settings.systemInstructions ?? ''}
                    placeholder="Anything the assistant must always do or never say."
                    disabled={readOnly || saving}
                    invalid={Boolean(fieldErrors.systemInstructions)}
                    onChange={(e) =>
                      update('systemInstructions', e.target.value)
                    }
                  />
                  <FieldError message={fieldErrors.systemInstructions} />
                </div>

                <ToggleRow
                  checked={settings.useEmojis}
                  disabled={readOnly || saving}
                  onChange={(v) => update('useEmojis', v)}
                  label="Use emojis"
                  description="Allow the occasional emoji in replies."
                />
              </div>
            </SectionCard>

            <SectionCard
              title="Welcome message"
              description="Sent once, on a customer's first message in a conversation — before the assistant answers."
            >
              <div className="space-y-4">
                <ToggleRow
                  checked={settings.welcomeEnabled}
                  disabled={readOnly || saving}
                  onChange={(v) => update('welcomeEnabled', v)}
                  label="Greet customers on first contact"
                  description="A first reply that opens with a bare answer reads as a machine. The greeting names your business first."
                />
                <div>
                  <Label htmlFor="ai-welcome">Your own wording (optional)</Label>
                  <Textarea
                    id="ai-welcome"
                    rows={4}
                    placeholder="Leave empty to use the built-in greeting, which uses your company name and matches the customer's language (Arabic or English)."
                    value={settings.welcomeMessage ?? ''}
                    disabled={readOnly || saving || !settings.welcomeEnabled}
                    invalid={Boolean(fieldErrors.welcomeMessage)}
                    onChange={(e) => update('welcomeMessage', e.target.value)}
                  />
                  <FieldError message={fieldErrors.welcomeMessage} />
                  <p className="mt-1 text-xs text-slate-500">
                    Clearing this box restores the built-in greeting. A short
                    “Powered by Thunder.AI” line is added underneath either way.
                  </p>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Standard messages"
              description="What the assistant says when it cannot help, and when it passes a conversation on."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="ai-fallback">Fallback message</Label>
                  <Textarea
                    id="ai-fallback"
                    value={settings.fallbackMessage}
                    disabled={readOnly || saving}
                    invalid={Boolean(fieldErrors.fallbackMessage)}
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
                    invalid={Boolean(fieldErrors.humanHandoffMessage)}
                    onChange={(e) =>
                      update('humanHandoffMessage', e.target.value)
                    }
                  />
                  <FieldError message={fieldErrors.humanHandoffMessage} />
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Automatic replies"
              description="Whether the assistant answers new inbound messages without waiting for your team."
            >
              <ToggleRow
                checked={settings.autoReplyEnabled}
                disabled={readOnly || saving}
                onChange={(v) => {
                  // Confirm before turning auto-reply ON.
                  if (v) setConfirmAutoReply(true);
                  else update('autoReplyEnabled', false);
                }}
                label="Reply automatically"
                description="The AI answers new inbound customer messages on its own. You can still pause it per conversation."
              />
            </SectionCard>

            <SectionCard
              title="Human handoff"
              description="Choose when the AI should stop replying and pass the conversation to your team."
            >
              <div className="space-y-4">
                <ToggleRow
                  checked={settings.handoffOnRequest}
                  disabled={readOnly || saving}
                  onChange={(v) => update('handoffOnRequest', v)}
                  label="When the customer asks for a human"
                  description="Any explicit request for a person hands the conversation over."
                />
                <ToggleRow
                  checked={settings.handoffOnLowConfidence}
                  disabled={readOnly || saving}
                  onChange={(v) => update('handoffOnLowConfidence', v)}
                  label="When the AI cannot answer"
                  description="Low-confidence answers go to your team instead of the customer."
                />

                <div>
                  <Label htmlFor="ai-handoff-keywords">Handoff keywords</Label>
                  <Input
                    id="ai-handoff-keywords"
                    value={keywordsText}
                    placeholder="complaint, refund, manager"
                    disabled={readOnly || saving}
                    invalid={Boolean(fieldErrors.handoffKeywords)}
                    onChange={(e) => setKeywordsText(e.target.value)}
                  />
                  <FieldError message={fieldErrors.handoffKeywords} />
                  <p className="mt-1 text-xs text-slate-500">
                    Separate with commas. A message containing any of these
                    words goes straight to a human (up to {MAX_KEYWORDS}).
                  </p>
                  {keywords.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {keywords.map((kw) => (
                        <Badge key={kw}>{kw}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </SectionCard>

            {/* Sticky save so it stays reachable on a phone (§5). */}
            {!readOnly && (
              <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur sm:hidden">
                <span className="text-xs text-slate-500">
                  Changes apply after saving
                </span>
                {saveButton}
              </div>
            )}
          </form>
        )}
      </div>

      <ConfirmDialog
        open={confirmAutoReply}
        title="Turn on automatic AI replies?"
        message="The AI will start answering new inbound customer messages on its own, using your company knowledge. You can pause it per conversation at any time."
        confirmLabel="Turn on auto-reply"
        onConfirm={() => {
          update('autoReplyEnabled', true);
          setConfirmAutoReply(false);
        }}
        onCancel={() => setConfirmAutoReply(false)}
      />
    </div>
  );
}
