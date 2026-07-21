import { createHmac } from 'node:crypto';
import request from 'supertest';
import type { Application } from 'express';
import { authHeader } from './helpers';
import type { FacebookTransport } from '../src/modules/channels';

/** Known test credentials + identifiers (never real). */
export const FB = {
  pageId: '100000000000123',
  pageName: 'Acme Page',
  accessToken: 'EAAG-test-page-token-1234567890',
  appSecret: 'test-fb-app-secret-abcdef',
  verifyToken: 'test-fb-verify-token-xyz',
  businessName: 'Acme FB',
  /** A customer page-scoped id (PSID). */
  customerPsid: '7788990011223344',
};

export function makeFacebookTransport(
  overrides: {
    send?: () => { status: number; ok: boolean; json: unknown };
    check?: () => { status: number; ok: boolean; json: unknown };
  } = {},
): { transport: FacebookTransport; calls: { method: string; url: string }[] } {
  const calls: { method: string; url: string }[] = [];
  const transport: FacebookTransport = {
    async request(input) {
      calls.push({ method: input.method, url: input.url });
      if (input.method === 'POST') {
        return (
          overrides.send?.() ?? {
            status: 200,
            ok: true,
            json: { recipient_id: FB.customerPsid, message_id: `fb.OUT.${Date.now()}` },
          }
        );
      }
      return (
        overrides.check?.() ?? {
          status: 200,
          ok: true,
          json: { id: FB.pageId, name: FB.pageName },
        }
      );
    },
  };
  return { transport, calls };
}

export function connectFacebook(
  app: Application,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  return request(app)
    .post('/api/v1/channels/facebook/connect')
    .set(authHeader(token))
    .send({
      displayName: 'Facebook',
      pageId: FB.pageId,
      pageName: FB.pageName,
      businessName: FB.businessName,
      accessToken: FB.accessToken,
      appSecret: FB.appSecret,
      verifyToken: FB.verifyToken,
      ...overrides,
    });
}

export function fbSign(rawBody: string, appSecret = FB.appSecret): string {
  return 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
}

export function fbVerify(
  app: Application,
  channelAccountId: string,
  query: Record<string, string>,
) {
  return request(app).get(`/api/v1/webhooks/facebook/${channelAccountId}`).query(query);
}

export function fbWebhook(
  app: Application,
  channelAccountId: string,
  body: unknown,
  opts: { appSecret?: string; badSignature?: boolean } = {},
) {
  const raw = JSON.stringify(body);
  const sig = opts.badSignature ? 'sha256=deadbeef' : fbSign(raw, opts.appSecret ?? FB.appSecret);
  return request(app)
    .post(`/api/v1/webhooks/facebook/${channelAccountId}`)
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', sig)
    .send(raw);
}

/** Build a Messenger inbound text webhook payload (object "page"). */
export function fbTextPayload(opts: { mid: string; from?: string; text: string }) {
  return {
    object: 'page',
    entry: [
      {
        id: FB.pageId,
        time: 1710000000000,
        messaging: [
          {
            sender: { id: opts.from ?? FB.customerPsid },
            recipient: { id: FB.pageId },
            timestamp: 1710000000000,
            message: { mid: opts.mid, text: opts.text },
          },
        ],
      },
    ],
  };
}

/** Build a Messenger delivery receipt payload (per-mid). */
export function fbDeliveryPayload(opts: { mids: string[] }) {
  return {
    object: 'page',
    entry: [
      {
        id: FB.pageId,
        messaging: [
          {
            sender: { id: FB.customerPsid },
            recipient: { id: FB.pageId },
            timestamp: 1710000000100,
            delivery: { mids: opts.mids, watermark: 1710000000100 },
          },
        ],
      },
    ],
  };
}

/** Build a Messenger echo payload. */
export function fbEchoPayload(opts: { mid: string; text: string }) {
  return {
    object: 'page',
    entry: [
      {
        id: FB.pageId,
        messaging: [
          {
            sender: { id: FB.pageId },
            recipient: { id: FB.customerPsid },
            timestamp: 1710000000000,
            message: { mid: opts.mid, text: opts.text, is_echo: true },
          },
        ],
      },
    ],
  };
}

/** Build a Messenger unsupported (attachment) payload. */
export function fbAttachmentPayload(opts: { mid: string; type?: string }) {
  return {
    object: 'page',
    entry: [
      {
        id: FB.pageId,
        messaging: [
          {
            sender: { id: FB.customerPsid },
            recipient: { id: FB.pageId },
            timestamp: 1710000000000,
            message: {
              mid: opts.mid,
              attachments: [{ type: opts.type ?? 'image', payload: { url: 'https://x.test/i.jpg' } }],
            },
          },
        ],
      },
    ],
  };
}
