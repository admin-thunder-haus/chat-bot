import type { AppNotification } from './types';

const INBOX = '/dashboard/inbox';
const BILLING = '/dashboard/billing';
const OPERATIONS = '/dashboard/operations';

/** Only the fields the mapping needs — any `AppNotification` satisfies this. */
export type NotificationTarget = Pick<AppNotification, 'type' | 'data'>;

/** Reads `data.conversationId` defensively (`data` is untyped JSON). */
function conversationIdOf(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const raw = (data as Record<string, unknown>).conversationId;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

/**
 * Where a notification should take the user.
 *
 * Backend `data` payloads (see `emitDomainEvent` call sites):
 *   NEW_CONVERSATION   { conversationId, customerId, channelType }
 *   HANDOFF_REQUESTED  { conversationId, reason }
 *   AI_REPLY_FAILED    { conversationId, reason }
 *   SYSTEM_ALERT       { actionKey, executionId, conversationId }  (AI actions)
 *   SUBSCRIPTION_EVENT { plan / status / … }
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
    // AI actions are audited on the operations page.
    case 'SYSTEM_ALERT':
      return OPERATIONS;
    default:
      return INBOX;
  }
}
