'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { canWrite } from '@/lib/permissions';
import { channelsApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { useToast } from '@/components/toast';
import { fullTime } from '@/lib/format';
import { ChannelDiagnosticsModal } from './ChannelDiagnosticsModal';
import { WhatsAppConnectModal } from './WhatsAppConnectModal';
import { InstagramConnectModal } from './InstagramConnectModal';
import type {
  ChannelAccount,
  ChannelConnectionState,
  ChannelProviderDescriptor,
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
} from '@/components/ui';

const CONNECTION_COLOR: Record<
  ChannelConnectionState,
  'slate' | 'green' | 'red' | 'amber' | 'blue'
> = {
  HEALTHY: 'green',
  DEGRADED: 'amber',
  UNAVAILABLE: 'red',
  AUTH_EXPIRED: 'red',
  UNKNOWN: 'slate',
};

/** Safe WhatsApp display number from account metadata (never a secret). */
function whatsAppDisplay(a: ChannelAccount): string | null {
  const wa = (a.metadata as { whatsapp?: { displayPhoneNumber?: string } } | null)
    ?.whatsapp;
  return wa?.displayPhoneNumber ?? null;
}

/** Safe Instagram config from account metadata (never a secret). */
function instagramConfig(
  a: ChannelAccount,
): { instagramUsername?: string; facebookPageId?: string } | null {
  return (
    (a.metadata as {
      instagram?: { instagramUsername?: string; facebookPageId?: string };
    } | null)?.instagram ?? null
  );
}

const CAPABILITY_LABELS: { key: keyof NonNullable<ChannelAccount['capabilities']>; label: string }[] =
  [
    { key: 'textMessages', label: 'Text' },
    { key: 'inboundMessaging', label: 'Inbound' },
    { key: 'outboundMessaging', label: 'Outbound' },
    { key: 'messageReplies', label: 'Replies' },
    { key: 'deliveryReceipts', label: 'Delivery' },
    { key: 'readReceipts', label: 'Read' },
    { key: 'webhookSignatures', label: 'Signed' },
    { key: 'mediaMessages', label: 'Media' },
  ];

export default function ChannelsPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const readOnly = !canWrite(user?.role);

  const [providers, setProviders] = useState<ChannelProviderDescriptor[]>([]);
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('Fake / Test Channel');
  const [addExternalId, setAddExternalId] = useState('');
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<ChannelAccount | null>(
    null,
  );
  const [diagnosticsFor, setDiagnosticsFor] = useState<ChannelAccount | null>(
    null,
  );
  const [whatsAppOpen, setWhatsAppOpen] = useState(false);
  const [instagramOpen, setInstagramOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([
        channelsApi.providers(),
        channelsApi.list(),
      ]);
      setProviders(p.providers);
      setAccounts(a.accounts);
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const fakeProvider = providers.find((p) => p.key === 'fake' && p.available);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddErrors({});
    setSaving(true);
    try {
      await channelsApi.create({
        providerKey: 'fake',
        displayName: addName.trim(),
        externalAccountId: addExternalId.trim() || undefined,
      });
      notify('Fake channel created', 'success');
      setAddOpen(false);
      setAddExternalId('');
      await load();
    } catch (err) {
      const parsed = parseApiError(err);
      setError(parsed.message);
      setAddErrors(parsed.fieldErrors);
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(account: ChannelAccount) {
    setBusyId(account.id);
    try {
      const { account: updated } = await channelsApi.setStatus(account.id, {
        isEnabled: !account.isEnabled,
      });
      setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      notify(updated.isEnabled ? 'Channel enabled' : 'Channel disabled', 'success');
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function runHealthCheck(account: ChannelAccount) {
    setBusyId(account.id);
    try {
      const { account: updated } = await channelsApi.healthCheck(account.id);
      setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      notify(`Health: ${updated.connectionState}`, 'success');
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function doDisconnect(account: ChannelAccount) {
    setBusyId(account.id);
    try {
      const { account: updated } = await channelsApi.disconnect(account.id);
      setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      notify('Channel disconnected', 'success');
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setBusyId(null);
      setConfirmDisconnect(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Channels"
        description="Connect messaging channels. Incoming and outgoing messages flow through one shared pipeline."
        actions={
          !readOnly && fakeProvider ? (
            <Button onClick={() => setAddOpen(true)}>Add fake channel</Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Alert variant="info">
          <strong>Web Chat</strong>, <strong>WhatsApp</strong>, and{' '}
          <strong>Instagram</strong> are live and flow through the same pipeline.
          Facebook Messenger and Telegram are honest placeholders for a later
          phase. The Fake / Test channel is a development-only provider that
          exercises the full framework without any external service.
        </Alert>
      </div>

      {readOnly && (
        <div className="mb-4">
          <Alert variant="info" message="You have read-only access to channels." />
        </div>
      )}
      {error && (
        <div className="mb-4">
          <Alert message={error} />
        </div>
      )}

      {/* Providers */}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Available providers
      </h2>
      {loading ? (
        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((p) => (
            <Panel key={p.key} className="flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <p className="font-medium text-slate-900">{p.displayName}</p>
                  {p.available ? (
                    <Badge color={p.developmentOnly ? 'amber' : 'green'}>
                      {p.developmentOnly ? 'Dev only' : 'Available'}
                    </Badge>
                  ) : (
                    <Badge color="slate">Coming soon</Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">{p.channelType}</p>
              </div>
              <div className="mt-3">
                {p.key === 'whatsapp' && p.available && !readOnly ? (
                  <Button size="sm" variant="secondary" onClick={() => setWhatsAppOpen(true)}>
                    Connect WhatsApp
                  </Button>
                ) : p.key === 'instagram' && p.available && !readOnly ? (
                  <Button size="sm" variant="secondary" onClick={() => setInstagramOpen(true)}>
                    Connect Instagram
                  </Button>
                ) : p.available && p.developmentOnly && !readOnly ? (
                  <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)}>
                    Add channel
                  </Button>
                ) : (
                  <span className="text-xs text-slate-400">
                    {p.available ? 'Ready' : 'Not available yet'}
                  </span>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}

      {/* Connected accounts */}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Your channels
      </h2>
      {loading ? (
        <div className="grid gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState
          title="No channels connected"
          description="Add the development fake channel to try the framework end-to-end."
          action={
            !readOnly && fakeProvider ? (
              <Button onClick={() => setAddOpen(true)}>Add fake channel</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3">
          {accounts.map((a) => (
            <Panel key={a.id}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-900">{a.displayName}</p>
                    <Badge color="blue">{a.providerKey}</Badge>
                    <Badge color={a.status === 'CONNECTED' ? 'green' : 'slate'}>
                      {a.status}
                    </Badge>
                    <Badge color={CONNECTION_COLOR[a.connectionState]}>
                      {a.connectionState}
                    </Badge>
                    {!a.isEnabled && <Badge color="red">Disabled</Badge>}
                  </div>
                  <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-slate-500 sm:grid-cols-2">
                    <div>Channel: {a.channelType}</div>
                    <div>Connected: {fullTime(a.connectedAt)}</div>
                    {a.providerKey === 'whatsapp' ? (
                      <>
                        <div>Phone: {whatsAppDisplay(a) ?? a.externalAccountId}</div>
                        <div>WABA: {a.externalPageId ?? '—'}</div>
                      </>
                    ) : a.providerKey === 'instagram' ? (
                      <>
                        <div>
                          Account:{' '}
                          {instagramConfig(a)?.instagramUsername
                            ? `@${instagramConfig(a)?.instagramUsername}`
                            : a.externalAccountId}
                        </div>
                        <div>Page: {a.externalPageId ?? '—'}</div>
                      </>
                    ) : (
                      <>
                        <div>Last check: {fullTime(a.lastHealthCheckAt)}</div>
                        <div>Last healthy: {fullTime(a.lastHealthyAt)}</div>
                      </>
                    )}
                  </dl>
                  {a.lastErrorMessage && a.connectionState !== 'HEALTHY' && (
                    <p className="mt-2 text-xs text-red-600">
                      {a.lastErrorCode ? `${a.lastErrorCode}: ` : ''}
                      {a.lastErrorMessage}
                    </p>
                  )}
                  {a.capabilities && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {CAPABILITY_LABELS.filter((c) => a.capabilities?.[c.key]).map(
                        (c) => (
                          <span
                            key={c.key}
                            className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600"
                          >
                            {c.label}
                          </span>
                        ),
                      )}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {a.providerKey === 'webchat' && (
                    <Link href={`/dashboard/channels/webchat/${a.id}`}>
                      <Button size="sm" variant="secondary">
                        Configure widget
                      </Button>
                    </Link>
                  )}
                  {/* Diagnostics is read-only monitoring — available to all roles. */}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setDiagnosticsFor(a)}
                  >
                    Diagnostics
                  </Button>
                  {!readOnly && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busyId === a.id}
                        onClick={() => void runHealthCheck(a)}
                      >
                        Health check
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyId === a.id || a.status === 'DISCONNECTED'}
                        onClick={() => void toggleEnabled(a)}
                      >
                        {a.isEnabled ? 'Disable' : 'Enable'}
                      </Button>
                      {a.status !== 'DISCONNECTED' && (
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busyId === a.id}
                          onClick={() => setConfirmDisconnect(a)}
                        >
                          Disconnect
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add fake channel">
        <form onSubmit={handleAdd} className="space-y-4">
          <p className="text-sm text-slate-500">
            The development fake channel uses a server-side secret from the
            environment. Only safe fields are configurable here — never
            credentials.
          </p>
          <div>
            <Label htmlFor="ch-name">Display name</Label>
            <Input
              id="ch-name"
              value={addName}
              disabled={saving}
              onChange={(e) => setAddName(e.target.value)}
            />
            <FieldError message={addErrors.displayName} />
          </div>
          <div>
            <Label htmlFor="ch-ext">External account ID (optional)</Label>
            <Input
              id="ch-ext"
              value={addExternalId}
              placeholder="fake-acct-1"
              disabled={saving}
              onChange={(e) => setAddExternalId(e.target.value)}
            />
            <FieldError message={addErrors.externalAccountId} />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAddOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Create channel
            </Button>
          </div>
        </form>
      </Modal>

      {diagnosticsFor && (
        <ChannelDiagnosticsModal
          account={diagnosticsFor}
          canManage={!readOnly}
          onClose={() => setDiagnosticsFor(null)}
        />
      )}

      <WhatsAppConnectModal
        open={whatsAppOpen}
        onClose={() => setWhatsAppOpen(false)}
        onConnected={() => void load()}
      />

      <InstagramConnectModal
        open={instagramOpen}
        onClose={() => setInstagramOpen(false)}
        onConnected={() => void load()}
      />

      <ConfirmDialog
        open={!!confirmDisconnect}
        title="Disconnect channel?"
        message="The channel will be disconnected and disabled. Your conversations and message history are preserved."
        confirmLabel="Disconnect"
        loading={busyId === confirmDisconnect?.id}
        onConfirm={() => confirmDisconnect && void doDisconnect(confirmDisconnect)}
        onCancel={() => setConfirmDisconnect(null)}
      />
    </div>
  );
}
