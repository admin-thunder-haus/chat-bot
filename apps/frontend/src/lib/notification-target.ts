import type { AppNotification } from './types';

const INBOX = '/dashboard/inbox';
const BILLING = '/dashboard/billing';
const OPERATIONS = '/dashboard/operations';
const CHANNELS = '/dashboard/channels';
const INTEGRATIONS = '/dashboard/integrations';

/** Only the fields the mapping needs — any `AppNotification` satisfies this. */
export type NotificationTarget = Pick<AppNotification, 'type' | 'data'>;

/** Reads a string field out of the untyped `data` JSON, defensively. */
function stringField(data: unknown, key: string): string | null {
  if (!data || typeof data !== 'object') return null;
  const raw = (data as Record<string, unknown>)[key];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

function conversationIdOf(data: unknown): string | null {
  return stringField(data, 'conversationId');
}

/**
 * Where a notification should take the user.
 *
 * Backend `data` payloads (see `emitDomainEvent` call sites):
 *   NEW_CONVERSATION   { conversationId, customerId, channelType }
 *   HANDOFF_REQUESTED  { conversationId, reason }
 *   AI_REPLY_FAILED    { conversationId, reason }
 *   SYSTEM_ALERT       { actionKey, executionId, conversationId }  (AI actions)
 *                      { channelAccountId, providerKey, connectionState }  (channel down)
 *                      { webhookId, url, failureCount }  (webhook auto-disabled)
 *   SUBSCRIPTION_EVENT { plan / status / … }
 *
 * SYSTEM_ALERT is deliberately a bucket for several unrelated operational
 * events, so it is routed by which id its `data` carries — landing an owner on
 * the audit page when a channel just died would waste the alert.
 *
 * Never returns an empty or dead link: unknown types and missing/malformed
 * `data` fall back to the inbox.
 */
export function notificationHref(n: NotificationTarget): string {
  switch (n.type) {
    case 'NEW_CONVERSATION':
    case 'HANDOFF_REQUESTED':
    case 'AI_REPLY_FAILED': {
      const id = conversationIdOf(n.data);
      return id ? `${INBOX}?conversation=${encodeURIComponent(id)}` : INBOX;
    }
    case 'SUBSCRIPTION_EVENT':
      return BILLING;
    case 'SYSTEM_ALERT': {
      // A broken channel or a switched-off webhook needs the page where it can
      // be fixed; everything else (AI actions) is audited on Operations.
      if (stringField(n.data, 'channelAccountId')) return CHANNELS;
      if (stringField(n.data, 'webhookId')) return INTEGRATIONS;
      return OPERATIONS;
    }
    default:
      return INBOX;
  }
}
