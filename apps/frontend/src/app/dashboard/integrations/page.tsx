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
  CopyButton,
  DataList,
  EmptyState,
  FieldError,
  Input,
  Label,
  Modal,
  PageHeader,
  SectionCard,
  Skeleton,
  Toggle,
  type DataListColumn,
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

const EVENT_LABELS: Record<string, string> = Object.fromEntries(
  EVENT_OPTIONS.map((o) => [o.value, o.label]),
);

/** A secret shown exactly once: readable, wrapped, and one click to copy. */
function SecretField({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-slate-700">{label}</p>
      <code className="block break-all rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800">
        {value}
      </code>
      <div className="mt-2">
        <CopyButton
          value={value}
          size="md"
          label={`Copy ${label.toLowerCase()}`}
          ariaLabel={`Copy ${label.toLowerCase()} to clipboard`}
        />
      </div>
    </div>
  );
}

/** Colored dots for the most recent deliveries (newest first). */
function DeliveryDots({ deliveries }: { deliveries: WebhookDelivery[] }) {
  if (deliveries.length === 0) {
    return <span className="text-xs text-slate-500">No deliveries yet</span>;
  }
  const failed = deliveries.filter((d) => d.status !== 'delivered').length;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {deliveries.slice(0, 10).map((d) => (
        <span
          key={d.id}
          title={`${EVENT_LABELS[d.eventType] ?? d.eventType} — ${d.status}${
            d.responseStatus ? ` (HTTP ${d.responseStatus})` : ''
          } · ${relativeTime(d.createdAt)} ago`}
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            d.status === 'delivered' ? 'bg-green-500' : 'bg-red-500'
          }`}
        />
      ))}
      {/* Never colour-only: say what the dots mean (§3). */}
      <span className="ml-1 text-xs text-slate-500">
        {failed === 0
          ? `last ${Math.min(deliveries.length, 10)} delivered`
          : `${failed} of the last ${Math.min(deliveries.length, 10)} failed`}
      </span>
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
  const [hookEventsError, setHookEventsError] = useState('');
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
      setHookEventsError('Select at least one event');
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
    setHookEventsError('');
    setCreatedSecret(null);
  }

  const keyColumns: DataListColumn<ApiKey>[] = [
    {
      key: 'name',
      header: 'Name',
      primary: true,
      cell: (key) => (
        <span className="break-words font-medium text-slate-900">
          {key.name}
        </span>
      ),
    },
    {
      key: 'prefix',
      header: 'Key',
      cell: (key) => (
        <code
          className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700"
          title="Only the prefix is stored — the full key was shown once at creation."
        >
          {key.keyPrefix}…
        </code>
      ),
    },
    {
      key: 'created',
      header: 'Created',
      cell: (key) => new Date(key.createdAt).toLocaleDateString(),
    },
    {
      key: 'lastUsed',
      header: 'Last used',
      cell: (key) =>
        key.lastUsedAt ? `${relativeTime(key.lastUsedAt)} ago` : 'Never',
    },
    {
      key: 'status',
      header: 'Status',
      cell: (key) =>
        key.revokedAt ? (
          <Badge color="red">Revoked</Badge>
        ) : (
          <Badge color="green">Active</Badge>
        ),
    },
  ];

  const hookColumns: DataListColumn<OutboundWebhook>[] = [
    {
      key: 'url',
      header: 'Endpoint',
      primary: true,
      cell: (hook) => (
        <div className="min-w-0">
          <p className="break-all font-medium text-slate-900" title={hook.url}>
            {hook.url}
          </p>
          <div className="mt-1">
            <CopyButton
              value={hook.url}
              label="Copy URL"
              ariaLabel={`Copy the webhook URL ${hook.url}`}
            />
          </div>
        </div>
      ),
    },
    {
      key: 'events',
      header: 'Events',
      cell: (hook) => (
        <div className="flex flex-wrap justify-end gap-1 md:justify-start">
          {hook.events.map((e) => (
            <Badge key={e} color="blue">
              {EVENT_LABELS[e] ?? e}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'deliveries',
      header: 'Recent deliveries',
      cell: (hook) => (
        <div className="flex flex-col items-end gap-1 md:items-start">
          <DeliveryDots deliveries={deliveries[hook.id] ?? []} />
          {hook.failureCount > 0 && (
            <span className="text-xs text-amber-700">
              {hook.failureCount} consecutive failure
              {hook.failureCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'active',
      header: 'Enabled',
      cell: (hook) => (
        <span className="inline-flex items-center gap-2">
          <Toggle
            checked={hook.isActive}
            onChange={(next) => void toggleHook(hook, next)}
            label={`${hook.isActive ? 'Disable' : 'Enable'} the webhook for ${hook.url}`}
          />
          <span className="text-xs text-slate-500">
            {hook.isActive ? 'Enabled' : 'Paused'}
          </span>
        </span>
      ),
    },
  ];

  if (!canManage) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader
          title="Integrations"
          description="API keys and outbound webhooks for your workspace."
        />
        <Alert
          variant="info"
          message="Only owners and admins can manage integrations. Ask an owner if you need an API key."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Integrations"
        description="Programmatic access to your workspace: API keys for the public API and signed webhooks for real-time events."
        actions={
          <>
            <Button variant="secondary" onClick={() => setHookDialogOpen(true)}>
              Add webhook
            </Button>
            <Button onClick={() => setKeyDialogOpen(true)}>
              Create API key
            </Button>
          </>
        }
      />

      <div className="space-y-6">
        {error && (
          <Alert>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{error} Your keys and webhooks could not be loaded.</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void load()}
                className="sm:shrink-0"
              >
                Try again
              </Button>
            </div>
          </Alert>
        )}

        {loading ? (
          <>
            <Skeleton className="h-56 rounded-xl" />
            <Skeleton className="h-56 rounded-xl" />
          </>
        ) : (
          <>
            <SectionCard
              title="API keys"
              description="Authenticate against the public API at /api/public/v1. A key is shown once, at creation."
              padded={false}
              actions={
                <Button
                  variant="secondary"
                  onClick={() => setKeyDialogOpen(true)}
                >
                  Create API key
                </Button>
              }
            >
              <div className="p-4 sm:p-6">
                <DataList
                  bare
                  items={apiKeys}
                  keyOf={(key) => key.id}
                  columns={keyColumns}
                  caption="API keys"
                  actions={(key) =>
                    key.revokedAt ? null : (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setRevokeTarget(key)}
                      >
                        Revoke
                      </Button>
                    )
                  }
                  empty={
                    <EmptyState
                      title="No API keys yet"
                      description="An API key lets your own systems read conversations and customers from this workspace."
                      action={
                        <Button onClick={() => setKeyDialogOpen(true)}>
                          Create API key
                        </Button>
                      }
                    />
                  }
                />
              </div>
            </SectionCard>

            <SectionCard
              title="Webhooks"
              description="Signed HTTP callbacks so your systems hear about events as they happen."
              padded={false}
              actions={
                <Button
                  variant="secondary"
                  onClick={() => setHookDialogOpen(true)}
                >
                  Add webhook
                </Button>
              }
            >
              <div className="p-4 sm:p-6">
                <DataList
                  bare
                  items={webhooks}
                  keyOf={(hook) => hook.id}
                  columns={hookColumns}
                  caption="Outbound webhooks"
                  actions={(hook) => (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setDeleteTarget(hook)}
                    >
                      Delete
                    </Button>
                  )}
                  empty={
                    <EmptyState
                      title="No webhooks yet"
                      description="Add an endpoint to receive signed events such as new conversations and handoff requests."
                      action={
                        <Button onClick={() => setHookDialogOpen(true)}>
                          Add webhook
                        </Button>
                      }
                    />
                  }
                />
              </div>
            </SectionCard>
          </>
        )}
      </div>

      {/* --- Create API key dialog --- */}
      <Modal
        open={keyDialogOpen}
        onClose={closeKeyDialog}
        title={createdKey ? 'API key created' : 'Create API key'}
        footer={
          createdKey ? (
            <Button onClick={closeKeyDialog}>Done</Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={closeKeyDialog}
                disabled={actionLoading}
              >
                Cancel
              </Button>
              <Button loading={actionLoading} onClick={() => void createKey()}>
                Create key
              </Button>
            </>
          )
        }
      >
        {createdKey ? (
          <div className="space-y-4">
            <Alert
              variant="warning"
              message="Copy this key now and store it somewhere safe — it is never shown again."
            />
            <SecretField label="API key" value={createdKey} />
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Name the key after the system that will use it, so you know what
              to revoke later.
            </p>
            <div>
              <Label htmlFor="api-key-name" required>
                Name
              </Label>
              <Input
                id="api-key-name"
                value={keyName}
                placeholder="CRM sync"
                maxLength={80}
                invalid={Boolean(keyNameError)}
                onChange={(e) => {
                  setKeyName(e.target.value);
                  setKeyNameError('');
                }}
              />
              <FieldError message={keyNameError} />
            </div>
          </div>
        )}
      </Modal>

      {/* --- Create webhook dialog --- */}
      <Modal
        open={hookDialogOpen}
        onClose={closeHookDialog}
        title={createdSecret ? 'Webhook created' : 'Add webhook'}
        footer={
          createdSecret ? (
            <Button onClick={closeHookDialog}>Done</Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={closeHookDialog}
                disabled={actionLoading}
              >
                Cancel
              </Button>
              <Button loading={actionLoading} onClick={() => void createHook()}>
                Add webhook
              </Button>
            </>
          )
        }
      >
        {createdSecret ? (
          <div className="space-y-4">
            <Alert
              variant="warning"
              message="Copy this signing secret now — it is never shown again. Use it to verify the X-Webhook-Signature header on every delivery."
            />
            <SecretField label="Signing secret" value={createdSecret} />
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
                invalid={Boolean(hookUrlError)}
                onChange={(e) => {
                  setHookUrl(e.target.value);
                  setHookUrlError('');
                }}
              />
              <FieldError message={hookUrlError} />
            </div>
            <fieldset>
              <legend className="mb-1 block text-sm font-medium text-slate-700">
                Events<span className="ml-0.5 text-red-500">*</span>
              </legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {EVENT_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="flex min-h-10 items-center gap-2 text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
                      checked={hookEvents.includes(option.value)}
                      onChange={(e) => {
                        setHookEventsError('');
                        setHookEvents((prev) =>
                          e.target.checked
                            ? [...prev, option.value]
                            : prev.filter((v) => v !== option.value),
                        );
                      }}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              <FieldError message={hookEventsError} />
            </fieldset>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={revokeTarget !== null}
        title="Revoke API key"
        message={
          revokeTarget
            ? `Revoke "${revokeTarget.name}"? Anything using it stops working immediately. This cannot be undone.`
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
            ? `Delete the webhook for ${deleteTarget.url}? Its delivery history is removed as well.`
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
