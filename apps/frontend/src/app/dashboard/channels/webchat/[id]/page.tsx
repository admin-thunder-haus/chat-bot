'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { canWrite } from '@/lib/permissions';
import { channelsApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { useToast } from '@/components/toast';
import type { ChannelAccount, WebChatConfig } from '@/lib/types';
import {
  Alert,
  Button,
  CopyButton,
  FieldError,
  Input,
  Label,
  PageHeader,
  SectionCard,
  Select,
  Skeleton,
  Tabs,
  Textarea,
  type TabItem,
} from '@/components/ui';
import { WidgetPreview } from '../WidgetPreview';

type PreviewTheme = 'light' | 'dark';

const THEME_TABS: readonly TabItem<PreviewTheme>[] = [
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

export default function WebChatConfigPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { user } = useAuth();
  const { notify } = useToast();
  const readOnly = !canWrite(user?.role);

  const [account, setAccount] = useState<ChannelAccount | null>(null);
  const [config, setConfig] = useState<WebChatConfig | null>(null);
  const [publicId, setPublicId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [previewTheme, setPreviewTheme] = useState<PreviewTheme>('light');

  const load = useCallback(async () => {
    setError('');
    setLoadFailed(false);
    try {
      const [{ account: acc }, cfg] = await Promise.all([
        channelsApi.get(id),
        channelsApi.getWidgetConfig(id),
      ]);
      setAccount(acc);
      setConfig(cfg.config);
      setPublicId(cfg.publicId);
    } catch (err) {
      setError(parseApiError(err).message);
      setLoadFailed(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const origin = useMemo(
    () => (typeof window !== 'undefined' ? window.location.origin : ''),
    [],
  );
  const embedSnippet = publicId
    ? `<script src="${origin}/widget.js" data-channel-key="${publicId}" async></script>`
    : '';

  function update<K extends keyof WebChatConfig>(
    key: K,
    value: WebChatConfig[K],
  ) {
    setConfig((c) => (c ? { ...c, [key]: value } : c));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!config) return;
    setError('');
    setLoadFailed(false);
    setFieldErrors({});
    setSaving(true);
    try {
      const { config: saved } = await channelsApi.updateWidgetConfig(id, {
        title: config.title,
        welcomeMessage: config.welcomeMessage,
        themeColor: config.themeColor,
        position: config.position,
        locale: config.locale,
        launcherText: config.launcherText,
        agentLabel: config.agentLabel,
        assistantLabel: config.assistantLabel,
      });
      setConfig(saved);
      notify('Widget configuration saved', 'success');
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
      form="webchat-form"
      loading={saving}
      loadingLabel="Saving…"
    >
      Save changes
    </Button>
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Web chat widget"
        description="Style the chat widget on your website, preview it, and copy the snippet that installs it."
        actions={
          <>
            <Link href="/dashboard/channels">
              <Button variant="secondary">Back to channels</Button>
            </Link>
            {!readOnly && config && (
              // On phones the sticky bar under the form carries Save.
              <span className="hidden sm:block">{saveButton}</span>
            )}
          </>
        }
      />

      <div className="space-y-6">
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
        {account && account.providerKey !== 'webchat' && (
          <Alert message="This channel is not a web chat channel, so there is no widget to configure." />
        )}
        {readOnly && (
          <Alert
            variant="info"
            message="You have read-only access. Ask an owner or admin to change the widget."
          />
        )}

        {!config ? (
          loadFailed ? null : (
            <div className="grid gap-6 lg:grid-cols-2">
              <Skeleton className="h-96 rounded-xl" />
              <Skeleton className="h-96 rounded-xl" />
            </div>
          )
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Config form */}
            <form id="webchat-form" onSubmit={save} className="space-y-6">
              <SectionCard
                title="What visitors see"
                description="The wording and colour of the widget on your site."
              >
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="wc-title">Header title</Label>
                    <Input
                      id="wc-title"
                      value={config.title}
                      disabled={readOnly || saving}
                      invalid={Boolean(fieldErrors.title)}
                      onChange={(e) => update('title', e.target.value)}
                    />
                    <FieldError message={fieldErrors.title} />
                  </div>

                  <div>
                    <Label htmlFor="wc-welcome">Welcome message</Label>
                    <Textarea
                      id="wc-welcome"
                      value={config.welcomeMessage}
                      disabled={readOnly || saving}
                      invalid={Boolean(fieldErrors.welcomeMessage)}
                      onChange={(e) => update('welcomeMessage', e.target.value)}
                    />
                    <FieldError message={fieldErrors.welcomeMessage} />
                    <p className="mt-1 text-xs text-slate-500">
                      The first thing a visitor reads when the widget opens.
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="wc-color">Theme colour</Label>
                    <div className="flex items-center gap-2">
                      <input
                        id="wc-color"
                        type="color"
                        value={config.themeColor}
                        disabled={readOnly || saving}
                        onChange={(e) => update('themeColor', e.target.value)}
                        className="h-10 w-12 shrink-0 rounded border border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                      />
                      <Input
                        value={config.themeColor}
                        aria-label="Theme colour hex value"
                        disabled={readOnly || saving}
                        invalid={Boolean(fieldErrors.themeColor)}
                        onChange={(e) => update('themeColor', e.target.value)}
                      />
                    </div>
                    <FieldError message={fieldErrors.themeColor} />
                  </div>

                  <div>
                    <Label htmlFor="wc-launcher">Launcher text</Label>
                    <Input
                      id="wc-launcher"
                      value={config.launcherText}
                      disabled={readOnly || saving}
                      invalid={Boolean(fieldErrors.launcherText)}
                      onChange={(e) => update('launcherText', e.target.value)}
                    />
                    <FieldError message={fieldErrors.launcherText} />
                    <p className="mt-1 text-xs text-slate-500">
                      Shown on the bubble before anyone opens the chat.
                    </p>
                  </div>
                </div>
              </SectionCard>

              <SectionCard
                title="Placement and language"
                description="Where the launcher sits and which language the widget uses."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="wc-position">Launcher position</Label>
                    <Select
                      id="wc-position"
                      value={config.position}
                      disabled={readOnly || saving}
                      onChange={(e) =>
                        update('position', e.target.value as 'left' | 'right')
                      }
                    >
                      <option value="right">Bottom right</option>
                      <option value="left">Bottom left</option>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="wc-locale">Locale</Label>
                    <Input
                      id="wc-locale"
                      value={config.locale}
                      placeholder="en"
                      disabled={readOnly || saving}
                      invalid={Boolean(fieldErrors.locale)}
                      onChange={(e) => update('locale', e.target.value)}
                    />
                    <FieldError message={fieldErrors.locale} />
                    <p className="mt-1 text-xs text-slate-500">
                      en or ar — sets the widget&apos;s own labels.
                    </p>
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="wc-agent">Agent label</Label>
                    <Input
                      id="wc-agent"
                      value={config.agentLabel}
                      disabled={readOnly || saving}
                      invalid={Boolean(fieldErrors.agentLabel)}
                      onChange={(e) => update('agentLabel', e.target.value)}
                    />
                    <FieldError message={fieldErrors.agentLabel} />
                    {/* No separate "Assistant label": the widget deliberately
                        labels every reply — AI or human — with the agent label
                        so visitors are never told which ones were automated.
                        The stored value is kept for backwards compatibility. */}
                    <p className="mt-1 text-xs text-slate-500">
                      Every reply is labelled with this name, whether it came
                      from your team or the AI.
                    </p>
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

            {/* Preview + install */}
            <div className="space-y-6">
              <SectionCard
                title="Preview"
                description="A static preview — it never creates real conversations."
              >
                <Tabs
                  tabs={THEME_TABS}
                  value={previewTheme}
                  onChange={setPreviewTheme}
                  size="sm"
                  label="Preview theme"
                  idPrefix="webchat-preview-theme"
                  className="mb-4"
                />
                <div className="rounded-xl bg-slate-100 p-3 sm:p-4">
                  <WidgetPreview
                    config={config}
                    dark={previewTheme === 'dark'}
                  />
                </div>
                {publicId && (
                  <p className="mt-3 text-center text-sm">
                    <Link
                      href={`/widget/${publicId}`}
                      target="_blank"
                      className="font-medium text-slate-900 underline"
                    >
                      Open the live widget in a new tab
                    </Link>
                  </p>
                )}
              </SectionCard>

              <SectionCard
                title="Install on your site"
                description="Paste this snippet before the closing body tag on any page. The widget key is public and safe to embed."
              >
                <div className="space-y-3">
                  <div>
                    <p className="mb-1 text-sm font-medium text-slate-700">
                      Widget key
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <code
                        className="min-w-0 break-all rounded bg-slate-100 px-2 py-1.5 text-xs text-slate-800"
                        title={publicId ?? undefined}
                      >
                        {publicId ?? '—'}
                      </code>
                      {publicId && (
                        <CopyButton
                          value={publicId}
                          label="Copy key"
                          ariaLabel="Copy the widget key to clipboard"
                          className="sm:shrink-0"
                        />
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="mb-1 text-sm font-medium text-slate-700">
                      Embed snippet
                    </p>
                    <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                      <code>{embedSnippet || '—'}</code>
                    </pre>
                    {embedSnippet && (
                      <div className="mt-2">
                        <CopyButton
                          value={embedSnippet}
                          label="Copy snippet"
                          ariaLabel="Copy the embed snippet to clipboard"
                        />
                      </div>
                    )}
                  </div>

                  <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-500">
                    <li>Copy the snippet above.</li>
                    <li>
                      Paste it into your website&apos;s HTML, just before the
                      closing body tag.
                    </li>
                    <li>
                      The launcher appears in the corner and visitors can chat
                      straight away.
                    </li>
                    <li>
                      Replies from your inbox and the AI show up in the widget
                      automatically.
                    </li>
                  </ol>
                </div>
              </SectionCard>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
