import type { NotificationType, UserRole } from '@prisma/client';

/**
 * Catalog of domain events the platform can emit. Kept in a tiny module (no
 * service imports) so validation schemas and docs can reference the list
 * without pulling the consumer wiring in.
 */
export const DOMAIN_EVENT_TYPES = [
  'conversation.created',
  'conversation.resolved',
  'customer.created',
  'handoff.requested',
  'ai.reply_failed',
  'subscription.updated',
  'action.executed',
  // --- Operational alerts: things the owner must act on, not business news ---
  // A channel stopped working (unreachable, or its sign-in expired), so
  // messages are no longer flowing until someone reconnects it.
  'channel.unavailable',
  // An outbound webhook endpoint was switched off after a long failure streak.
  'webhook.auto_disabled',
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export interface DomainEvent {
  companyId: string;
  type: DomainEventType;
  /** Short human-readable headline (notification title / webhook data.title). */
  title: string;
  /** One-line human-readable description. */
  body: string;
  /** Safe, structured event payload (ids, enum values — never secrets). */
  data?: Record<string, unknown>;
  /**
   * When set, an in-app notification row is created for the company; users
   * whose role is in `emailRoles` additionally receive an email. When omitted
   * the event is webhook-only.
   */
  notify?: {
    type: NotificationType;
    emailRoles?: UserRole[];
  };
}
