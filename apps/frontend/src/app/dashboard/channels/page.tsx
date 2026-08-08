'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { canWrite } from '@/lib/permissions';
import { channelsApi } from '@/lib/resources';
import type {
  InstagramLoginStatus,
  MetaOauthStatus,
} from '@/lib/resources/channels';
import { parseApiError } from '@/lib/form';
import { useToast } from '@/components/toast';
import { channelLabel, fullTime } from '@/lib/format';
import { ChannelDiagnosticsModal } from './ChannelDiagnosticsModal';
import { WhatsAppConnectModal } from './WhatsAppConnectModal';
import { InstagramConnectModal } from './InstagramConnectModal';
import { FacebookConnectModal } from './FacebookConnectModal';
import { TelegramConnectModal } from './TelegramConnectModal';
import type {
  ChannelAccount,
  ChannelAccountStatus,
  ChannelConnectionState,
  ChannelProviderDescriptor,
} from '@/lib/types';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataList,
  EmptyState,
  FieldError,
  Input,
  Label,
  Modal,
  PageHeader,
  SectionCard,
  Skeleton,
  type DataListColumn,
} from '@/components/ui';

type BadgeColor = 'slate' | 'green' | 'red' | 'amber' | 'blue';

/** Humanised connection health — colour always sits next to the word (§3). */
const CONNECTION_STATE: Record<
  ChannelConnectionState,
  { label: string; color: BadgeColor }
> = {
  HEALTHY: { label: 'Healthy', color: 'green' },
  DEGRADED: { label: 'Degraded', color: 'amber' },
  UNAVAILABLE: { label: 'Unavailable', color: 'red' },
  AUTH_EXPIRED: { label: 'Sign-in expired', color: 'red' },
  UNKNOWN: { label: 'Not checked yet', color: 'slate' },
};

/** Humanised account status (§8). */
const ACCOUNT_STATUS: Record<
  ChannelAccountStatus,
  { label: string; color: BadgeColor }
> = {
  DRAFT: { label: 'Draft', color: 'slate' },
  CONNECTED: { label: 'Connected', color: 'green' },
  DISCONNECTED: { label: 'Disconnected', color: 'slate' },
  ERROR: { label: 'Error', color: 'red' },
  SUSPENDED: { label: 'Suspended', color: 'amber' },
};

/** Safe WhatsApp display number from account metadata (never a secret). */
function whatsAppDisplay(a: ChannelAccount): string | null {
  const wa = (
    a.metadata as { whatsapp?: { displayPhoneNumber?: string } } | null
  )?.whatsapp;
  return wa?.displayPhoneNumber ?? null;
}

/** Safe Instagram config from account metadata (never a secret). */
function instagramConfig(
  a: ChannelAccount,
): { instagramUsername?: string; facebookPageId?: string } | null {
  return (
    (
      a.metadata as {
        instagram?: { instagramUsername?: string; facebookPageId?: string };
      } | null
    )?.instagram ?? null
  );
}

/** Safe Facebook config from account metadata (never a secret). */
function facebookConfig(a: ChannelAccount): { pageName?: string } | null {
  return (
    (a.metadata as { facebook?: { pageName?: string } } | null)?.facebook ??
    null
  );
}

/** Safe Telegram config from account metadata (never a secret). */
function telegramConfig(a: ChannelAccount): { botUsername?: string } | null {
  return (
    (a.metadata as { telegram?: { botUsername?: string } } | null)?.telegram ??
    null
  );
}

/** Friendly copy for the safe error codes the OAuth callback can return. */
const CONNECT_ERROR_MESSAGES: Record<string, string> = {
  ACCESS_DENIED: 'The Meta authorization was cancelled or denied.',
  INVALID_STATE:
    'The connect link expired or was invalid — start the connection again.',
  OAUTH_NOT_CONFIGURED: 'Meta OAuth is not configured for this deployment.',
  TOKEN_EXCHANGE_FAILED:
    'Meta rejected the authorization code — try connecting again.',
  NO_PAGES: 'No Facebook Pages were shared during the Meta authorization.',
  NO_INSTAGRAM_ACCOUNT:
    'The shared Facebook Page has no linked Instagram professional account.',
  NO_WABA: 'No WhatsApp Business Account was shared during signup.',
  NO_PHONE_NUMBER:
    'The shared WhatsApp Business Account has no registered phone numbers.',
  ALREADY_CONNECTED: 'This account is already connected.',
  CONNECT_FAILED: 'The Meta connection failed — try again.',
};

const CONNECTED_LABELS: Record<string, string> = {
  facebook: 'Facebook Messenger',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
};

/** Provider key → the name a person recognises (§8). */
const PROVIDER_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  facebook: 'Facebook Messenger',
  telegram: 'Telegram',
  webchat: 'Web chat',
  fake: 'Fake / test channel',
};

function providerLabel(key: string): string {
  return PROVIDER_LABELS[key] ?? key;
}

const CAPABILITY_LABELS: {
  key: keyof NonNullable<ChannelAccount['capabilities']>;
  label: string;
}[] = [
  { key: 'textMessages', label: 'Text' },
  { key: 'inboundMessaging', label: 'Inbound' },
  { key: 'outboundMessaging', label: 'Outbound' },
  { key: 'messageReplies', label: 'Replies' },
  { key: 'deliveryReceipts', label: 'Delivery' },
  { key: 'readReceipts', label: 'Read' },
  { key: 'webhookSignatures', label: 'Signed' },
  { key: 'mediaMessages', label: 'Media' },
];

/** Provider-specific identity rows, safe to display (never secrets). */
function accountDetails(a: ChannelAccount): { label: string; value: string }[] {
  if (a.providerKey === 'whatsapp') {
    return [
      {
        label: 'Phone',
        value: whatsAppDisplay(a) ?? a.externalAccountId ?? '—',
      },
      { label: 'Business account', value: a.externalPageId ?? '—' },
    ];
  }
  if (a.providerKey === 'instagram') {
    const username = instagramConfig(a)?.instagramUsername;
    return [
      {
        label: 'Account',
        value: username ? `@${username}` : (a.externalAccountId ?? '—'),
      },
      { label: 'Facebook Page', value: a.externalPageId ?? '—' },
    ];
  }
  if (a.providerKey === 'facebook') {
    return [
      {
        label: 'Page',
        value: facebookConfig(a)?.pageName ?? a.externalAccountId ?? '—',
      },
      { label: 'Page ID', value: a.externalAccountId ?? '—' },
    ];
  }
  if (a.providerKey === 'telegram') {
    const bot = telegramConfig(a)?.botUsername;
    return [
      { label: 'Bot', value: bot ? `@${bot}` : a.displayName },
      { label: 'Bot ID', value: a.externalAccountId ?? '—' },
    ];
  }
  return [
    { label: 'Last checked', value: fullTime(a.lastHealthCheckAt) || 'Never' },
    { label: 'Last healthy', value: fullTime(a.lastHealthyAt) || 'Never' },
  ];
}

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
  const [confirmDisconnect, setConfirmDisconnect] =
    useState<ChannelAccount | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ChannelAccount | null>(
    null,
  );
  const [diagnosticsFor, setDiagnosticsFor] = useState<ChannelAccount | null>(
    null,
  );
  const [whatsAppOpen, setWhatsAppOpen] = useState(false);
  const [instagramOpen, setInstagramOpen] = useState(false);
  const [facebookOpen, setFacebookOpen] = useState(false);
  const [telegramOpen, setTelegramOpen] = useState(false);
  const [metaOauth, setMetaOauth] = useState<MetaOauthStatus | null>(null);
  const [igLogin, setIgLogin] = useState<InstagramLoginStatus | null>(null);
  const [oauthBanner, setOauthBanner] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [p, a, meta, ig] = await Promise.all([
        channelsApi.providers(),
        channelsApi.list(),
        // OAuth availability is optional decoration — never fail the page.
        channelsApi.oauthStatus().catch(() => null),
        channelsApi.instagramLoginStatus().catch(() => null),
      ]);
      setProviders(p.providers);
      setAccounts(a.accounts);
      setMetaOauth(meta);
      setIgLogin(ig);
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Returning from the Meta OAuth redirect: surface ?connected= /
  // ?connect_error= once, then strip the params from the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const connectError = params.get('connect_error');
    if (!connected && !connectError) return;
    if (connected) {
      setOauthBanner({
        kind: 'success',
        message: `${CONNECTED_LABELS[connected] ?? connected} connected via ${
          connected === 'instagram' ? 'Instagram' : 'Meta'
        }.`,
      });
    } else if (connectError) {
      setOauthBanner({
        kind: 'error',
        message:
          CONNECT_ERROR_MESSAGES[connectError] ??
          CONNECT_ERROR_MESSAGES.CONNECT_FAILED,
      });
    }
    params.delete('connected');
    params.delete('connect_error');
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}`,
    );
  }, []);

  const metaConfigured = metaOauth?.configured === true;
  const loginOauthAvailable = metaConfigured && !!metaOauth?.loginConfigId;
  const whatsappOauthAvailable =
    metaConfigured && !!metaOauth?.whatsappConfigId;
  // Instagram rides its own app identity, so the Facebook config says nothing
  // about whether one-click Instagram works.
  const instagramOauthAvailable = igLogin?.configured === true;

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
      notify('Test channel created', 'success');
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
      setAccounts((prev) =>
        prev.map((a) => (a.id === updated.id ? updated : a)),
      );
      notify(
        updated.isEnabled ? 'Channel enabled' : 'Channel disabled',
        'success',
      );
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
      setAccounts((prev) =>
        prev.map((a) => (a.id === updated.id ? updated : a)),
      );
      notify(
        `Health: ${CONNECTION_STATE[updated.connectionState].label}`,
        'success',
      );
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
      setAccounts((prev) =>
        prev.map((a) => (a.id === updated.id ? updated : a)),
      );
      notify('Channel disconnected', 'success');
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setBusyId(null);
      setConfirmDisconnect(null);
    }
  }

  async function doDelete(account: ChannelAccount) {
    setBusyId(account.id);
    try {
      await channelsApi.deletePermanently(account.id);
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
      notify('Channel deleted', 'success');
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setBusyId(null);
      setConfirmDelete(null);
    }
  }

  const accountColumns: DataListColumn<ChannelAccount>[] = [
    {
      key: 'channel',
      header: 'Channel',
      primary: true,
      cell: (a) => (
        <div className="min-w-0">
          <p className="break-words font-medium text-slate-900">
            {a.displayName}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {providerLabel(a.providerKey)} · {channelLabel(a.channelType)}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (a) => (
        <div className="flex flex-wrap justify-end gap-1 md:justify-start">
          <Badge color={ACCOUNT_STATUS[a.status].color}>
            {ACCOUNT_STATUS[a.status].label}
          </Badge>
          {!a.isEnabled && <Badge color="red">Disabled</Badge>}
        </div>
      ),
    },
    {
      key: 'health',
      header: 'Health',
      cell: (a) => (
        <div className="flex flex-col items-end gap-1 md:items-start">
          <Badge color={CONNECTION_STATE[a.connectionState].color}>
            {CONNECTION_STATE[a.connectionState].label}
          </Badge>
          {a.lastErrorMessage && a.connectionState !== 'HEALTHY' && (
            <p className="text-right text-xs text-red-600 md:text-left">
              {a.lastErrorCode ? `${a.lastErrorCode}: ` : ''}
              {a.lastErrorMessage}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'details',
      header: 'Details',
      cell: (a) => (
        <div className="space-y-0.5 text-xs text-slate-500">
          {accountDetails(a).map((row) => (
            <p key={row.label} className="break-words">
              <span className="text-slate-400">{row.label}:</span> {row.value}
            </p>
          ))}
          <p className="break-words">
            <span className="text-slate-400">Connected:</span>{' '}
            {fullTime(a.connectedAt) || 'Not yet'}
          </p>
        </div>
      ),
    },
    {
      key: 'capabilities',
      header: 'Supports',
      hideOnMobile: true,
      cell: (a) =>
        a.capabilities ? (
          <div className="flex flex-wrap gap-1">
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
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Channels"
        description="Connect the places your customers message you. Everything flows into one shared inbox."
        actions={
          !readOnly && fakeProvider ? (
            <Button variant="secondary" onClick={() => setAddOpen(true)}>
              Add test channel
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-6">
        {oauthBanner && (
          <Alert
            variant={oauthBanner.kind === 'success' ? 'success' : 'error'}
            message={oauthBanner.message}
          />
        )}

        {readOnly && (
          <Alert
            variant="info"
            message="You have read-only access to channels. Ask an owner or admin to connect or change one."
          />
        )}
        {error && (
          <Alert>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{error}</span>
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

        {/* Providers */}
        <SectionCard
          title="Available channels"
          description="Web chat, WhatsApp, Instagram, Facebook Messenger and Telegram are all live. The fake channel is a development-only provider for testing the pipeline end to end."
        >
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-lg" />
              ))}
            </div>
          ) : providers.length === 0 ? (
            <EmptyState
              title="No providers available"
              description="No messaging providers are enabled for this deployment yet."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {providers.map((p) => (
                <div
                  key={p.key}
                  className="flex flex-col justify-between gap-3 rounded-lg border border-slate-200 p-4"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-slate-900">
                        {p.displayName}
                      </p>
                      {p.available ? (
                        <Badge color={p.developmentOnly ? 'amber' : 'green'}>
                          {p.developmentOnly ? 'Development only' : 'Available'}
                        </Badge>
                      ) : (
                        <Badge color="slate">Coming soon</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {channelLabel(p.channelType)}
                    </p>
                  </div>
                  <div>
                    {p.key === 'whatsapp' && p.available && !readOnly ? (
                      <Button
                        variant="secondary"
                        fullWidth
                        onClick={() => setWhatsAppOpen(true)}
                      >
                        Connect WhatsApp
                      </Button>
                    ) : p.key === 'instagram' && p.available && !readOnly ? (
                      <Button
                        variant="secondary"
                        fullWidth
                        onClick={() => setInstagramOpen(true)}
                      >
                        Connect Instagram
                      </Button>
                    ) : p.key === 'facebook' && p.available && !readOnly ? (
                      <Button
                        variant="secondary"
                        fullWidth
                        onClick={() => setFacebookOpen(true)}
                      >
                        Connect Facebook
                      </Button>
                    ) : p.key === 'telegram' && p.available && !readOnly ? (
                      <Button
                        variant="secondary"
                        fullWidth
                        onClick={() => setTelegramOpen(true)}
                      >
                        Connect Telegram
                      </Button>
                    ) : p.available && p.developmentOnly && !readOnly ? (
                      <Button
                        variant="secondary"
                        fullWidth
                        onClick={() => setAddOpen(true)}
                      >
                        Add test channel
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-500">
                        {p.available
                          ? 'Ready to use'
                          : 'Not available in this deployment yet'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Connected accounts */}
        <SectionCard
          title="Your connected channels"
          description="Each connection, its health, and the controls to pause or remove it."
          padded={false}
        >
          <div className="p-4 sm:p-6">
            <DataList
              bare
              items={accounts}
              loading={loading}
              skeletonRows={2}
              keyOf={(a) => a.id}
              columns={accountColumns}
              caption="Connected channels"
              actions={(a) => (
                <>
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
                        disabled={
                          busyId === a.id || a.status === 'DISCONNECTED'
                        }
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
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busyId === a.id}
                        onClick={() => setConfirmDelete(a)}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </>
              )}
              empty={
                <EmptyState
                  title="No channels connected yet"
                  description="Connect a channel above and its messages start arriving in your inbox. The fake test channel is the fastest way to try it."
                  action={
                    !readOnly && fakeProvider ? (
                      <Button onClick={() => setAddOpen(true)}>
                        Add test channel
                      </Button>
                    ) : undefined
                  }
                />
              }
            />
          </div>
        </SectionCard>
      </div>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add test channel"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAddOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" form="fake-channel-form" loading={saving}>
              Create channel
            </Button>
          </>
        }
      >
        <form id="fake-channel-form" onSubmit={handleAdd} className="space-y-4">
          <p className="text-sm text-slate-500">
            The development test channel uses a server-side secret from the
            environment, so there is nothing sensitive to enter here.
          </p>
          <div>
            <Label htmlFor="ch-name">Display name</Label>
            <Input
              id="ch-name"
              value={addName}
              disabled={saving}
              invalid={Boolean(addErrors.displayName)}
              onChange={(e) => setAddName(e.target.value)}
            />
            <FieldError message={addErrors.displayName} />
          </div>
          <div>
            <Label htmlFor="ch-ext">External account ID</Label>
            <Input
              id="ch-ext"
              value={addExternalId}
              placeholder="fake-acct-1"
              disabled={saving}
              invalid={Boolean(addErrors.externalAccountId)}
              onChange={(e) => setAddExternalId(e.target.value)}
            />
            <FieldError message={addErrors.externalAccountId} />
            <p className="mt-1 text-xs text-slate-500">
              Optional. Leave blank and one is generated for you.
            </p>
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
        oauthAvailable={whatsappOauthAvailable}
        metaAppId={metaOauth?.appId ?? null}
        whatsappConfigId={metaOauth?.whatsappConfigId ?? null}
      />

      <InstagramConnectModal
        open={instagramOpen}
        onClose={() => setInstagramOpen(false)}
        onConnected={() => void load()}
        oauthAvailable={instagramOauthAvailable}
      />

      <FacebookConnectModal
        open={facebookOpen}
        onClose={() => setFacebookOpen(false)}
        onConnected={() => void load()}
        oauthAvailable={loginOauthAvailable}
      />

      <TelegramConnectModal
        open={telegramOpen}
        onClose={() => setTelegramOpen(false)}
        onConnected={() => void load()}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete this channel permanently?"
        message="The channel and its stored credentials are removed for good, freeing it to be reconnected later. Your conversations and message history are kept."
        confirmLabel="Delete permanently"
        loading={busyId === confirmDelete?.id}
        onConfirm={() => confirmDelete && void doDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />

      <ConfirmDialog
        open={!!confirmDisconnect}
        title="Disconnect this channel?"
        message="The channel stops sending and receiving messages until you reconnect it. Your conversations and message history are kept."
        confirmLabel="Disconnect"
        loading={busyId === confirmDisconnect?.id}
        onConfirm={() =>
          confirmDisconnect && void doDisconnect(confirmDisconnect)
        }
        onCancel={() => setConfirmDisconnect(null)}
      />
    </div>
  );
}
