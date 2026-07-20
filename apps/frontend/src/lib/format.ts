import type {
  ChannelType,
  ConversationPriority,
  ConversationStatus,
  CustomerSummary,
} from './types';

/** Human display name for a customer, with sensible fallbacks. */
export function customerName(
  c: Pick<CustomerSummary, 'fullName' | 'username' | 'phone' | 'email'>,
): string {
  return (
    c.fullName || c.username || c.phone || c.email || 'Unknown customer'
  );
}

const CHANNEL_LABELS: Record<ChannelType, string> = {
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  TELEGRAM: 'Telegram',
  WEBCHAT: 'Web chat',
  EMAIL: 'Email',
  MANUAL: 'Manual',
};

export function channelLabel(channel: ChannelType): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

export const STATUS_COLORS: Record<
  ConversationStatus,
  'slate' | 'green' | 'amber' | 'blue' | 'red'
> = {
  OPEN: 'green',
  PENDING: 'amber',
  RESOLVED: 'blue',
  CLOSED: 'slate',
};

export const PRIORITY_COLORS: Record<
  ConversationPriority,
  'slate' | 'green' | 'amber' | 'blue' | 'red'
> = {
  LOW: 'slate',
  NORMAL: 'blue',
  HIGH: 'amber',
  URGENT: 'red',
};

/** Compact relative time like "5m", "2h", "3d", else a date. */
export function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

/** Absolute, human-readable timestamp. */
export function fullTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString();
}
