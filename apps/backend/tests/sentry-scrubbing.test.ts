import express from 'express';
import request from 'supertest';
import type { Event } from '@sentry/node';
import { errorHandler } from '../src/middlewares/error.middleware';
import {
  captureServerError,
  isSentryEnabled,
  scrubEvent,
} from '../src/config/sentry';

/**
 * Two guarantees are tested here, both without a DSN (the state every dev
 * machine and CI run is in):
 *   1. the scrubber removes secrets/PII from an event before it can be sent, and
 *   2. the integration is completely inert — no init, no SDK load, no capture.
 *
 * The mock factory below THROWS: it is not a stub, it is a tripwire. If any
 * import path pulls @sentry/node in while no DSN is configured, every test in
 * this file fails loudly.
 */
jest.mock('@sentry/node', () => {
  throw new Error('@sentry/node must not be loaded when SENTRY_DSN is unset');
});

describe('scrubEvent — request headers', () => {
  it('redacts credential headers but keeps ordinary ones', () => {
    const event = scrubEvent({
      request: {
        headers: {
          authorization: 'Bearer eyJhbGciOi.super.secret',
          Cookie: 'session=abc123; refresh=def456',
          'x-api-key': 'ak_live_1234567890',
          'content-type': 'application/json',
          'user-agent': 'jest',
        },
      },
    } as Event);

    const headers = event.request?.headers ?? {};
    expect(headers.authorization).toBe('[redacted]');
    expect(headers.Cookie).toBe('[redacted]');
    expect(headers['x-api-key']).toBe('[redacted]');
    // Harmless headers survive — the report has to stay useful.
    expect(headers['content-type']).toBe('application/json');
    expect(headers['user-agent']).toBe('jest');
  });

  it('redacts every provider webhook signature header', () => {
    const event = scrubEvent({
      request: {
        headers: {
          'x-hub-signature-256': 'sha256=deadbeef', // WhatsApp / IG / Messenger
          'x-telegram-bot-api-secret-token': 'telegram-secret',
          'stripe-signature': 't=1,v1=deadbeef',
          'x-webhook-signature': 'sha256=cafebabe',
          'x-fake-signature': 'abc123',
        },
      },
    } as Event);

    for (const value of Object.values(event.request?.headers ?? {})) {
      expect(value).toBe('[redacted]');
    }
  });

  it('replaces the whole cookie jar rather than itemising it', () => {
    const event = scrubEvent({
      request: { cookies: { accessToken: 'a.b.c', theme: 'dark' } },
    } as Event);

    expect(JSON.stringify(event.request?.cookies)).not.toContain('a.b.c');
    expect(JSON.stringify(event.request?.cookies)).not.toContain('dark');
  });
});

describe('scrubEvent — body and query', () => {
  it('redacts secret-ish body keys and leaves the rest intact', () => {
    const event = scrubEvent({
      request: {
        data: {
          email: 'owner@example.com',
          password: 'hunter2',
          accessToken: 'EAAG...',
          apiKey: 'ak_live_x',
          clientSecret: 'sh_x',
          signature: 'sha256=x',
          credential: 'x',
          sentryDsn: 'https://public@o1.ingest.sentry.io/1',
          displayName: 'Main WhatsApp',
          page: 2,
        },
      },
    } as Event);

    const data = event.request?.data as Record<string, unknown>;
    for (const key of [
      'password',
      'accessToken',
      'apiKey',
      'clientSecret',
      'signature',
      'credential',
      'sentryDsn',
    ]) {
      expect(data[key]).toBe('[redacted]');
    }
    // Not secret-ish: kept so the error is still diagnosable.
    expect(data.displayName).toBe('Main WhatsApp');
    expect(data.page).toBe(2);
  });

  it('redacts nested objects and objects inside arrays', () => {
    const event = scrubEvent({
      request: {
        data: {
          channel: {
            displayName: 'Main WhatsApp',
            credentials: { accessToken: 'EAAG-nested', appSecret: 'nested' },
          },
          accounts: [
            { id: 'acct-1', verifyToken: 'leaky' },
            { id: 'acct-2', webhookSecret: 'also-leaky' },
          ],
        },
      },
    } as Event);

    const serialized = JSON.stringify(event.request?.data);
    expect(serialized).not.toContain('EAAG-nested');
    expect(serialized).not.toContain('leaky');
    expect(serialized).not.toContain('also-leaky');
    // Structure and safe ids survive the pass.
    expect(serialized).toContain('acct-1');
    expect(serialized).toContain('Main WhatsApp');
  });

  it('drops anything nested past the depth cap instead of trusting it', () => {
    // 8 levels deep, deeper than MAX_DEPTH (6).
    const deep = { l1: { l2: { l3: { l4: { l5: { l6: { l7: { l8: 'buried' } } } } } } } };
    const event = scrubEvent({ request: { data: deep } } as Event);

    expect(JSON.stringify(event.request?.data)).not.toContain('buried');
    expect(JSON.stringify(event.request?.data)).toContain('too deep');
  });

  it('redacts secret params in a query string and in the url', () => {
    const event = scrubEvent({
      request: {
        url: 'https://api.example.com/api/v1/channels?page=2&access_token=EAAG-url',
        query_string: 'page=2&verify_token=vt-secret&status=open',
      },
    } as Event);

    expect(event.request?.url).toContain('page=2');
    expect(event.request?.url).not.toContain('EAAG-url');
    expect(event.request?.query_string).toContain('page=2');
    expect(event.request?.query_string).toContain('status=open');
    expect(event.request?.query_string).not.toContain('vt-secret');
  });
});

describe('scrubEvent — user PII', () => {
  it('redacts email and phone but keeps the id', () => {
    const event = scrubEvent({
      user: {
        id: 'user-1',
        email: 'owner@example.com',
        phone: '+9715xxxxxxx',
        ip_address: '203.0.113.7',
        role: 'OWNER',
      },
    } as Event);

    expect(event.user?.id).toBe('user-1');
    expect(event.user?.email).toBe('[redacted]');
    expect(event.user?.phone).toBe('[redacted]');
    expect(event.user?.ip_address).toBe('[redacted]');
    expect(event.user?.role).toBe('OWNER');
  });
});

describe('scrubEvent — hostile input', () => {
  it('survives an empty event and missing sections', () => {
    expect(() => scrubEvent({} as Event)).not.toThrow();
    expect(scrubEvent({ request: {} } as Event)).toEqual({ request: {} });
  });

  it('survives null/undefined values inside the payload', () => {
    const event = scrubEvent({
      request: { data: { a: null, b: undefined, token: null } },
      user: undefined,
      extra: { nothing: null },
    } as Event);

    const data = event.request?.data as Record<string, unknown>;
    expect(data.a).toBeNull();
    expect(data.token).toBe('[redacted]');
  });

  it('does not hang or throw on a circular payload', () => {
    const circular: Record<string, unknown> = { name: 'loop', apiKey: 'secret' };
    circular.self = circular;

    const event = scrubEvent({ request: { data: circular } } as Event);
    const serialized = JSON.stringify(event.request?.data);
    expect(serialized).not.toContain('secret');
    expect(serialized).toContain('circular');
  });

  it('scrubs breadcrumb data and extra context too', () => {
    const event = scrubEvent({
      extra: { requestBody: { password: 'hunter2', page: 1 } },
      breadcrumbs: [
        { message: 'db query', data: { sql: 'select 1', apiKey: 'ak_live_x' } },
      ],
    } as Event);

    expect(JSON.stringify(event.extra)).not.toContain('hunter2');
    expect(JSON.stringify(event.breadcrumbs)).not.toContain('ak_live_x');
    expect(JSON.stringify(event.breadcrumbs)).toContain('select 1');
  });
});

describe('Sentry is inert without a DSN', () => {
  it('reports itself disabled and captures nothing', () => {
    expect(isSentryEnabled()).toBe(false);
    // A no-op, NOT a throw: call sites must never branch on configuration.
    expect(() =>
      captureServerError(new Error('boom'), { requestId: 'req-1' }),
    ).not.toThrow();
  });

  it('an unhandled 500 still returns the normal error response', async () => {
    const app = express();
    app.get('/boom', () => {
      throw new Error('kaboom');
    });
    app.use(errorHandler);

    const res = await request(app).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Internal server error');
    // The real error text never reaches the client.
    expect(JSON.stringify(res.body)).not.toContain('kaboom');
    expect(isSentryEnabled()).toBe(false);
  });
});
