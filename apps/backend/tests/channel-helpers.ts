import { createHmac } from 'node:crypto';
import request from 'supertest';
import type { Application } from 'express';
import { authHeader } from './helpers';

const WEBHOOK_SECRET = 'test-fake-webhook-secret';
const VERIFY_TOKEN = 'test-fake-verify-token';
const SIGNATURE_HEADER = 'x-fake-signature';

export const fakeChannel = {
  secret: WEBHOOK_SECRET,
  verifyToken: VERIFY_TOKEN,
  signatureHeader: SIGNATURE_HEADER,
};

/** Create a fake channel account through the API; returns the account view. */
export async function createFakeChannel(
  app: Application,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await request(app)
    .post('/api/v1/channels')
    .set(authHeader(token))
    .send({
      providerKey: 'fake',
      displayName: 'Fake Channel',
      externalAccountId: 'fake-acct-1',
      ...overrides,
    });
  return res;
}

/** HMAC-SHA256 hex signature over the exact raw body string. */
export function sign(rawBody: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
}

export interface FakeInboundOptions {
  eventId?: string;
  messageId: string;
  customerId?: string;
  text?: string;
  customerName?: string;
  conversationId?: string;
}

/** Build a fake inbound-message webhook body. */
export function fakeInboundBody(opts: FakeInboundOptions): Record<string, unknown> {
  return {
    event: 'message',
    eventId: opts.eventId ?? `evt-${opts.messageId}`,
    messageId: opts.messageId,
    conversationId: opts.conversationId,
    text: opts.text ?? 'Hello from the fake channel',
    customer: {
      id: opts.customerId ?? 'fake-customer-1',
      name: opts.customerName ?? 'Fake Customer',
    },
  };
}

/**
 * POST a webhook body to a channel account with a valid signature (unless a
 * `badSignature` override is given). Signs the exact serialized bytes sent.
 */
export function postWebhook(
  app: Application,
  channelAccountId: string,
  body: unknown,
  opts: { badSignature?: boolean; providerKey?: string } = {},
) {
  const raw = JSON.stringify(body);
  const signature = opts.badSignature ? 'deadbeef' : sign(raw);
  const provider = opts.providerKey ?? 'fake';
  return request(app)
    .post(`/api/v1/webhooks/${provider}/${channelAccountId}`)
    .set('Content-Type', 'application/json')
    .set(SIGNATURE_HEADER, signature)
    .send(raw);
}

/** GET the verification challenge for a channel account. */
export function verifyWebhook(
  app: Application,
  channelAccountId: string,
  query: Record<string, string>,
  providerKey = 'fake',
) {
  return request(app)
    .get(`/api/v1/webhooks/${providerKey}/${channelAccountId}`)
    .query(query);
}
