'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { integrationsApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { relativeTime } from '@/lib/format';
import { useToast } from '@/components/toast';
import type {
  ApiKey,
  DomainEventType,
  OutboundWebhook,
  WebhookDelivery,
} from '@/lib/types';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  FieldError,
  Input,
  Label,
  Modal,
  PageHeader,
  Panel,
  Skeleton,
  Toggle,
} from '@/components/ui';

const EVENT_OPTIONS: { value: DomainEventType; label: string }[] = [
  { value: 'conversation.created', label: 'Conversation created' },
  { value: 'conversation.resolved', label: 'Conversation resolved' },
  { value: 'customer.created', label: 'Customer created' },
  { value: 'handoff.requested', label: 'Handoff requested' },
  { value: 'ai.reply_failed', label: 'AI reply failed' },
  { value: 'subscription.updated', label: 'Subscription updated' },
  { value: 'action.executed', label: 'Action executed' },
];

function CopyField({ value, label }: { value: string; label: string }) {
  const { notify } = useToast();
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-slate-700">{label}</p>
      <div className="flex gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800">
          {value}
        </code>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void navigator.clipboard
              .writeText(value)
              .then(() => notify('Copied to clipboard', 'success'))
              .catch(() => notify('Could not copy — select it manually', 'error'));
          }}
        >
          Copy
        </Button>
      </div>
    </div>
  );
}

/** Colored dots for the most recent deliveries (newest first). */
function DeliveryDots({ deliveries }: { deliveries: WebhookDelivery[] }) {
  if (deliveries.length === 0) {
    return <span className="text-xs text-slate-400">No deliveries yet</span>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      {deliveries.slice(0, 10).map((d) => (
        <span
          key={d.id}
          title={`${d.eventType} — ${d.status}${
            d.responseStatus ? ` (HTTP ${d.responseStatus})` : ''
          } · ${relativeTime(d.createdAt)} ago`}
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            d.status === 'delivered' ? 'bg-green-500' : 'bg-red-500'
          }`}
        />
      ))}
    </span>
  );
}

export default function IntegrationsPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const canManage = user?.role === 'OWNER' || user?.role === 'ADMIN';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<OutboundWebhook[]>([]);
  const [deliveries, setDeliveries] = useState<
    Record<string, WebhookDelivery[]>
  >({});

  // API-key creation dialog
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [keyNameError, setKeyNameError] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);

  // Webhook creation dialog
  const [hookDialogOpen, setHookDialogOpen] = useState(false);
  const [hookUrl, setHookUrl] = useState('');
  const [hookUrlError, setHookUrlError] = useState('');
  const [hookEvents, setHookEvents] = useState<DomainEventType[]>([]);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OutboundWebhook | null>(
    null,
  );

  const [actionLoading, setActionLoading] = useState(false);

  const loadDeliveries = useCallback(async (hooks: OutboundWebhook[]) => {
    const entries = await Promise.all(
      hooks.map(async (hook) => {
        try {
          const res = await integrationsApi.webhookDeliveries(hook.id);
          return [hook.id, res.deliveries] as const;
        } catch {
          return [hook.id, []] as const;
        }
      }),
    );
    setDeliveries(Object.fromEntries(entries));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [keysRes, hooksRes] = await Promise.all([
        integrationsApi.listApiKeys(),
        integrationsApi.listWebhooks(),
      ]);
      setApiKeys(keysRes.apiKeys);
      setWebhooks(hooksRes.webhooks);
      void loadDeliveries(hooksRes.webhooks);
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [loadDeliveries]);

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, load]);

  async function createKey() {
    if (!keyName.trim()) {
      setKeyNameError('Name is required');
      return;
    }
    setActionLoading(true);
    try {
      const result = await integrationsApi.createApiKey(keyName.trim());
      setCreatedKey(result.key);
      setApiKeys((prev) => [result.apiKey, ...prev]);
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function revokeKey() {
    if (!revokeTarget) return;
    setActionLoading(true);
    try {
      const { apiKey } = await integrationsApi.revokeApiKey(revokeTarget.id);
      setApiKeys((prev) => prev.map((k) => (k.id === apiKey.id ? apiKey : k)));
      setRevokeTarget(null);
      notify('API key revoked', 'success');
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function createHook() {
    let invalid = false;
    if (!/^https?:\/\//i.test(hookUrl.trim())) {
      setHookUrlError('Enter a valid http(s) URL');
      invalid = true;
    }
    if (hookEvents.length === 0) {
      notify('Select at least one event', 'error');
      invalid = true;
    }
    if (invalid) return;
    setActionLoading(true);
    try {
      const result = await integrationsApi.createWebhook({
        url: hookUrl.trim(),
        events: hookEvents,
      });
      setCreatedSecret(result.secret);
      setWebhooks((prev) => [result.webhook, ...prev]);
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function toggleHook(hook: OutboundWebhook, isActive: boolean) {
    try {
      const { webhook } = await integrationsApi.updateWebhook(hook.id, {
        isActive,
      });
      setWebhooks((prev) =>
        prev.map((w) => (w.id === webhook.id ? webhook : w)),
      );
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    }
  }

  async function deleteHook() {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      await integrationsApi.deleteWebhook(deleteTarget.id);
      setWebhooks((prev) => prev.filter((w) => w.id !== deleteTarget.id));
      setDeleteTarget(null);
      notify('Webhook deleted', 'success');
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setActionLoading(false);
    }
  }

  function closeKeyDialog() {
    setKeyDialogOpen(false);
    setKeyName('');
    setKeyNameError('');
    setCreatedKey(null);
  }

  function closeHookDialog() {
    setHookDialogOpen(false);
    setHookUrl('');
    setHookUrlError('');
    setHookEvents([]);
    setCreatedSecret(null);
  }

  if (!canManage) {
    return (
      <div>
        <PageHeader
          title="Integrations"
          description="API keys and outbound webhooks."
        />
        <Alert
          variant="info"
          message="Only owners and admins can manage integrations."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Programmatic access to your workspace: API keys for the public API and signed webhooks for real-time events."
      />

      {error && (
        <div className="mb-4">
          <Alert message={error} />
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {/* --- API keys --- */}
          <Panel>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  API keys
                </h2>
                <p className="text-sm text-slate-500">
                  Authenticate against the public API at{' '}
                  <code className="text-xs">/api/public/v1</code>.
                </p>
              </div>
              <Button onClick={() => setKeyDialogOpen(true)}>
                Create key
              </Button>
            </div>

            {apiKeys.length === 0 ? (
              <EmptyState
                title="No API keys yet"
                description="Create a key to read conversations and customers from your own systems."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {apiKeys.map((key) => (
                  <li
                    key={key.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {key.name}
                        </p>
                        {key.revokedAt ? (
                          <Badge color="red">Revoked</Badge>
                        ) : (
                          <Badge color="green">Active</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        <code>{key.keyPrefix}…</code> · created{' '}
                        {new Date(key.createdAt).toLocaleDateString()}
                        {key.lastUsedAt &&
                          ` · last used ${relativeTime(key.lastUsedAt)} ago`}
                      </p>
                    </div>
                    {!key.revokedAt && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setRevokeTarget(key)}
                      >
                        Revoke
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* --- Webhooks --- */}
          <Panel>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Webhooks
                </h2>
                <p className="text-sm text-slate-500">
                  Signed HTTP callbacks for events in your workspace.
                </p>
              </div>
              <Button onClick={() => setHookDialogOpen(true)}>
                Add webhook
              </Button>
            </div>

            {webhooks.length === 0 ? (
              <EmptyState
                title="No webhooks yet"
                description="Add an endpoint to receive signed events like new conversations and handoffs."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {webhooks.map((hook) => (
                  <li key={hook.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {hook.url}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {hook.events.map((e) => (
                            <Badge key={e} color="blue">
                              {e}
                            </Badge>
                          ))}
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <DeliveryDots
                            deliveries={deliveries[hook.id] ?? []}
                          />
                          {hook.failureCount > 0 && (
                            <span className="text-xs text-amber-600">
                              {hook.failureCount} consecutive failure
                              {hook.failureCount === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Toggle
                          checked={hook.isActive}
                          onChange={(next) => void toggleHook(hook, next)}
                          label={`Webhook ${hook.isActive ? 'active' : 'inactive'}`}
                        />
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setDeleteTarget(hook)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {/* --- Create API key dialog --- */}
      <Modal
        open={keyDialogOpen}
        onClose={closeKeyDialog}
        title={createdKey ? 'API key created' : 'Create API key'}
      >
        {createdKey ? (
          <div className="space-y-4">
            <Alert
              variant="warning"
              message="Copy the key now — it will never be shown again."
            />
            <CopyField label="API key" value={createdKey} />
            <div className="flex justify-end">
              <Button onClick={closeKeyDialog}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label htmlFor="api-key-name" required>
                Name
              </Label>
              <Input
                id="api-key-name"
                value={keyName}
                placeholder="e.g. CRM sync"
                maxLength={80}
                onChange={(e) => {
                  setKeyName(e.target.value);
                  setKeyNameError('');
                }}
              />
              <FieldError message={keyNameError} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={closeKeyDialog}>
                Cancel
              </Button>
              <Button loading={actionLoading} onClick={() => void createKey()}>
                Create key
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* --- Create webhook dialog --- */}
      <Modal
        open={hookDialogOpen}
        onClose={closeHookDialog}
        title={createdSecret ? 'Webhook created' : 'Add webhook'}
      >
        {createdSecret ? (
          <div className="space-y-4">
            <Alert
              variant="warning"
              message="Copy the signing secret now — it will never be shown again. Use it to verify the X-Webhook-Signature header."
            />
            <CopyField label="Signing secret" value={createdSecret} />
            <div className="flex justify-end">
              <Button onClick={closeHookDialog}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label htmlFor="webhook-url" required>
                Endpoint URL
              </Label>
              <Input
                id="webhook-url"
                value={hookUrl}
                placeholder="https://example.com/hooks/support"
                onChange={(e) => {
                  setHookUrl(e.target.value);
                  setHookUrlError('');
                }}
              />
              <FieldError message={hookUrlError} />
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-slate-700">
                Events<span className="ml-0.5 text-red-500">*</span>
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {EVENT_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="flex items-center gap-2 text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={hookEvents.includes(option.value)}
                      onChange={(e) =>
                        setHookEvents((prev) =>
                          e.target.checked
                            ? [...prev, option.value]
                            : prev.filter((v) => v !== option.value),
                        )
                      }
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={closeHookDialog}>
                Cancel
              </Button>
              <Button loading={actionLoading} onClick={() => void createHook()}>
                Add webhook
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={revokeTarget !== null}
        title="Revoke API key"
        message={
          revokeTarget
            ? `Revoke "${revokeTarget.name}"? Integrations using it will stop working immediately. This cannot be undone.`
            : ''
        }
        confirmLabel="Revoke key"
        loading={actionLoading}
        onConfirm={() => void revokeKey()}
        onCancel={() => setRevokeTarget(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete webhook"
        message={
          deleteTarget
            ? `Delete the webhook for ${deleteTarget.url}? Its delivery history will be removed as well.`
            : ''
        }
        confirmLabel="Delete webhook"
        loading={actionLoading}
        onConfirm={() => void deleteHook()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
