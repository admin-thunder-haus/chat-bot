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
  Badge,
  Button,
  FieldError,
  Input,
  Label,
  PageHeader,
  Panel,
  Select,
  Skeleton,
  Textarea,
} from '@/components/ui';
import { WidgetPreview } from '../WidgetPreview';

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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [previewDark, setPreviewDark] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
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

  function update<K extends keyof WebChatConfig>(key: K, value: WebChatConfig[K]) {
    setConfig((c) => (c ? { ...c, [key]: value } : c));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!config) return;
    setError('');
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

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(embedSnippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      notify('Copy failed — select and copy manually', 'error');
    }
  }

  return (
    <div>
      <PageHeader
        title="Web Chat widget"
        description="Configure the website chat widget, preview it, and copy the install snippet."
        actions={
          <div className="flex gap-2">
            <Link href="/dashboard/channels">
              <Button variant="secondary">Back to channels</Button>
            </Link>
            {!readOnly && config && (
              <Button type="submit" form="webchat-form" loading={saving}>
                Save
              </Button>
            )}
          </div>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert message={error} />
        </div>
      )}
      {account && account.providerKey !== 'webchat' && (
        <Alert message="This channel is not a Web Chat channel." />
      )}

      {!config ? (
        <Panel>
          <Skeleton className="h-64" />
        </Panel>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Config form */}
          <form id="webchat-form" onSubmit={save}>
            <Panel className="space-y-4">
              {readOnly && (
                <Alert variant="info" message="You have read-only access." />
              )}
              <div>
                <Label htmlFor="wc-title">Header title</Label>
                <Input
                  id="wc-title"
                  value={config.title}
                  disabled={readOnly || saving}
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
                  onChange={(e) => update('welcomeMessage', e.target.value)}
                />
                <FieldError message={fieldErrors.welcomeMessage} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="wc-color">Theme color</Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="wc-color"
                      type="color"
                      value={config.themeColor}
                      disabled={readOnly || saving}
                      onChange={(e) => update('themeColor', e.target.value)}
                      className="h-9 w-12 rounded border border-slate-300"
                    />
                    <Input
                      value={config.themeColor}
                      disabled={readOnly || saving}
                      onChange={(e) => update('themeColor', e.target.value)}
                    />
                  </div>
                  <FieldError message={fieldErrors.themeColor} />
                </div>
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
                  <Label htmlFor="wc-launcher">Launcher text</Label>
                  <Input
                    id="wc-launcher"
                    value={config.launcherText}
                    disabled={readOnly || saving}
                    onChange={(e) => update('launcherText', e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="wc-locale">Locale</Label>
                  <Input
                    id="wc-locale"
                    value={config.locale}
                    placeholder="en / ar"
                    disabled={readOnly || saving}
                    onChange={(e) => update('locale', e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="wc-agent">Agent label</Label>
                  <Input
                    id="wc-agent"
                    value={config.agentLabel}
                    disabled={readOnly || saving}
                    onChange={(e) => update('agentLabel', e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="wc-assistant">Assistant label</Label>
                  <Input
                    id="wc-assistant"
                    value={config.assistantLabel}
                    disabled={readOnly || saving}
                    onChange={(e) => update('assistantLabel', e.target.value)}
                  />
                </div>
              </div>
            </Panel>
          </form>

          {/* Preview + install */}
          <div className="space-y-6">
            <Panel>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">Preview</p>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setPreviewDark(false)}
                    className={`rounded px-2 py-1 ${!previewDark ? 'bg-slate-900 text-white' : 'bg-slate-100'}`}
                  >
                    Light
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewDark(true)}
                    className={`rounded px-2 py-1 ${previewDark ? 'bg-slate-900 text-white' : 'bg-slate-100'}`}
                  >
                    Dark
                  </button>
                </div>
              </div>
              <div className="rounded-xl bg-slate-100 p-4">
                <WidgetPreview config={config} dark={previewDark} />
              </div>
              {publicId && (
                <div className="mt-3 text-center">
                  <Link
                    href={`/widget/${publicId}`}
                    target="_blank"
                    className="text-sm font-medium text-blue-600 underline"
                  >
                    Open live preview ↗
                  </Link>
                </div>
              )}
            </Panel>

            <Panel>
              <p className="text-sm font-semibold text-slate-800">Installation</p>
              <p className="mt-1 text-xs text-slate-500">
                Paste this snippet before <code>&lt;/body&gt;</code> on any page.
                The widget key is public and safe to embed.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Badge color="blue">Widget key</Badge>
                <code className="truncate rounded bg-slate-100 px-2 py-1 text-xs">
                  {publicId ?? '—'}
                </code>
              </div>
              <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                <code>{embedSnippet}</code>
              </pre>
              <div className="mt-2">
                <Button size="sm" variant="secondary" onClick={copySnippet}>
                  {copied ? 'Copied ✓' : 'Copy snippet'}
                </Button>
              </div>
              <ol className="mt-4 list-decimal space-y-1 pl-5 text-xs text-slate-500">
                <li>Copy the snippet above.</li>
                <li>Paste it into your website&apos;s HTML before the closing body tag.</li>
                <li>The launcher appears in the corner — visitors can chat instantly.</li>
                <li>Replies from your Inbox and AI appear in the widget automatically.</li>
              </ol>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
