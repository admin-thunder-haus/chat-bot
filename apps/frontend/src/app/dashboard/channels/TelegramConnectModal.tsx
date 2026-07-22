'use client';

import { useState } from 'react';
import { channelsApi } from '@/lib/resources';
import { parseApiError } from '@/lib/form';
import { useToast } from '@/components/toast';
import {
  Alert,
  Button,
  FieldError,
  Input,
  Label,
  Modal,
} from '@/components/ui';

/**
 * Connect a Telegram bot. Only the bot token (from @BotFather) is needed — it is
 * sent ONCE, encrypted at rest, and never returned. On submit the backend
 * verifies the token (getMe) AND automatically registers the webhook with
 * Telegram, so there is no manual webhook step.
 */
export function TelegramConnectModal({
  open,
  onClose,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  onConnected: () => void;
}) {
  const { notify } = useToast();
  const [displayName, setDisplayName] = useState('Telegram');
  const [botToken, setBotToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setFieldErrors({});
    setSaving(true);
    try {
      const { account, webhookRegistered } = await channelsApi.connectTelegram({
        displayName: displayName.trim(),
        botToken: botToken.trim(),
      });
      if (account.connectionState === 'HEALTHY' && webhookRegistered) {
        notify('Telegram connected and webhook active', 'success');
      } else if (account.connectionState === 'HEALTHY') {
        notify('Bot verified, but the webhook could not be set — try again', 'error');
      } else {
        notify('Telegram bot token is invalid — check @BotFather', 'error');
      }
      onConnected();
      onClose();
    } catch (err) {
      const parsed = parseApiError(err);
      setError(parsed.message);
      setFieldErrors(parsed.fieldErrors);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Connect Telegram">
      <form onSubmit={submit} className="space-y-4">
        <Alert variant="info">
          Create a bot with <strong>@BotFather</strong> on Telegram and paste its
          token below. We verify it and set the webhook automatically — no manual
          setup. The token is encrypted at rest and never shown again.
        </Alert>

        <div>
          <Label htmlFor="tg-name">Display name</Label>
          <Input id="tg-name" value={displayName} disabled={saving} onChange={(e) => setDisplayName(e.target.value)} />
          <FieldError message={fieldErrors.displayName} />
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-xs font-semibold text-amber-800">
            Bot token (stored encrypted, never displayed again)
          </p>
          <Label htmlFor="tg-token" required>Bot token</Label>
          <Input
            id="tg-token"
            type="password"
            autoComplete="off"
            placeholder="123456789:AA…"
            value={botToken}
            disabled={saving}
            onChange={(e) => setBotToken(e.target.value)}
          />
          <FieldError message={fieldErrors.botToken} />
        </div>

        {error && <Alert message={error} />}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Connect Telegram
          </Button>
        </div>
      </form>
    </Modal>
  );
}
