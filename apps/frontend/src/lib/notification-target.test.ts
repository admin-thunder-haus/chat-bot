import { describe, expect, it } from 'vitest';
import { notificationHref } from './notification-target';
import type { NotificationType } from './types';

const CONV_ID = '3f0d6c1e-1c3e-4b6f-9a1b-2f8f1d5c7e90';

describe('notificationHref', () => {
  it('deep-links conversation notifications to the inbox', () => {
    const types: NotificationType[] = [
      'NEW_CONVERSATION',
      'HANDOFF_REQUESTED',
      'AI_REPLY_FAILED',
    ];
    for (const type of types) {
      expect(notificationHref({ type, data: { conversationId: CONV_ID } })).toBe(
        `/dashboard/inbox?conversation=${CONV_ID}`,
      );
    }
  });

  it('keeps extra data keys out of the href', () => {
    expect(
      notificationHref({
        type: 'HANDOFF_REQUESTED',
        data: { conversationId: CONV_ID, reason: 'CUSTOMER_REQUEST' },
      }),
    ).toBe(`/dashboard/inbox?conversation=${CONV_ID}`);
  });

  it('sends subscription events to billing', () => {
    expect(
      notificationHref({
        type: 'SUBSCRIPTION_EVENT',
        data: { plan: 'PRO', status: 'ACTIVE' },
      }),
    ).toBe('/dashboard/billing');
  });

  it('sends AI action alerts to operations', () => {
    expect(
      notificationHref({
        type: 'SYSTEM_ALERT',
        data: { actionKey: 'book_appointment', conversationId: CONV_ID },
      }),
    ).toBe('/dashboard/operations');
  });

  it('sends a dead-channel alert to the page where it can be reconnected', () => {
    expect(
      notificationHref({
        type: 'SYSTEM_ALERT',
        data: {
          channelAccountId: 'acct-1',
          providerKey: 'whatsapp',
          connectionState: 'AUTH_EXPIRED',
        },
      }),
    ).toBe('/dashboard/channels');
  });

  it('sends an auto-disabled webhook alert to integrations', () => {
    expect(
      notificationHref({
        type: 'SYSTEM_ALERT',
        data: { webhookId: 'wh-1', url: 'https://example.test/hook' },
      }),
    ).toBe('/dashboard/integrations');
  });

  it('an operational alert with no ids still lands somewhere useful', () => {
    expect(notificationHref({ type: 'SYSTEM_ALERT', data: null })).toBe(
      '/dashboard/operations',
    );
  });

  it('falls back to the inbox when data is missing or malformed', () => {
    expect(notificationHref({ type: 'NEW_CONVERSATION', data: null })).toBe(
      '/dashboard/inbox',
    );
    expect(notificationHref({ type: 'AI_REPLY_FAILED', data: undefined })).toBe(
      '/dashboard/inbox',
    );
    expect(notificationHref({ type: 'HANDOFF_REQUESTED', data: 'nope' })).toBe(
      '/dashboard/inbox',
    );
    expect(
      notificationHref({ type: 'NEW_CONVERSATION', data: { conversationId: '' } }),
    ).toBe('/dashboard/inbox');
    expect(
      notificationHref({ type: 'NEW_CONVERSATION', data: { conversationId: 42 } }),
    ).toBe('/dashboard/inbox');
  });

  it('falls back to the inbox for unknown types', () => {
    expect(
      notificationHref({
        type: 'FUTURE_TYPE' as NotificationType,
        data: { foo: 'bar' },
      }),
    ).toBe('/dashboard/inbox');
  });
});
