import { logger } from '../../utils/logger';
import { notificationsService } from '../notifications/notifications.service';
import { outboundWebhooksService } from '../public-api/outbound-webhooks.service';
import type { DomainEvent } from './domain-events.types';

export type { DomainEvent, DomainEventType } from './domain-events.types';
export { DOMAIN_EVENT_TYPES } from './domain-events.types';

/**
 * Central domain-event emitter with two consumers:
 *   (a) in-app notifications (+ optional role-targeted emails), and
 *   (b) customer-configured signed outbound webhooks.
 *
 * The promise resolves once both consumers have run, which keeps tests
 * deterministic — but it NEVER rejects: a consumer failure is logged and
 * swallowed so emitting an event can never break the host flow (message
 * ingestion, billing, AI replies, …). Call sites simply `await` it.
 */
export async function emitDomainEvent(event: DomainEvent): Promise<void> {
  if (event.notify) {
    try {
      await notificationsService.createFromEvent({
        companyId: event.companyId,
        type: event.notify.type,
        title: event.title,
        body: event.body,
        data: event.data,
        emailRoles: event.notify.emailRoles,
      });
    } catch (err) {
      logger.warn('events.notification.failed', {
        companyId: event.companyId,
        eventType: event.type,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  try {
    await outboundWebhooksService.dispatchEvent(event.companyId, event.type, {
      title: event.title,
      body: event.body,
      ...(event.data ?? {}),
    });
  } catch (err) {
    logger.warn('events.webhookDispatch.failed', {
      companyId: event.companyId,
      eventType: event.type,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
