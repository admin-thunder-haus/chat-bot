import { createHmac } from 'node:crypto';
import request from 'supertest';
import type { Application } from 'express';
import { authHeader } from './helpers';
import type { InstagramTransport } from '../src/modules/channels';

/** Known test credentials + identifiers (never real). */
export const IG = {
  instagramAccountId: '17841400000000001',
  facebookPageId: '100000000000001',
  instagramUsername: 'acme.support',
  accessToken: 'IGAAtest-access-token-1234567890',
  appSecret: 'test-ig-app-secret-abcdef',
  verifyToken: 'test-ig-verify-token-xyz',
  businessName: 'Acme IG',
  /** A customer Instagram-scoped ID (IGSID). */
  customerIgsid: '9988776655443322',
};

/**
 * A scriptable fake Meta transport so tests never hit the network. `send` and
 * `check` can be overridden to simulate 401/429/5xx/permission/etc.
 */
export function makeInstagramTransport(
  overrides: {
    send?: () => { status: number; ok: boolean; json: unknown };
    check?: () => { status: number; ok: boolean; json: unknown };
  } = {},
): { transport: InstagramTransport; calls: { method: string; url: string }[] } {
  const calls: { method: string; url: string }[] = [];
  const transport: InstagramTransport = {
    async request(input) {
      calls.push({ method: input.method, url: input.url });
      if (input.method === 'POST') {
        return (
          overrides.send?.() ?? {
            status: 200,
            ok: true,
            json: { recipient_id: IG.customerIgsid, message_id: `ig.OUT.${Date.now()}` },
          }
        );
      }
      return (
        overrides.check?.() ?? {
          status: 200,
          ok: true,
          json: {
            id: IG.instagramAccountId,
            username: IG.instagramUsername,
            name: IG.businessName,
          },
        }
      );
    },
  };
  return { transport, calls };
}

/** Connect an Instagram channel via the API; returns the account response. */
export function connectInstagram(
  app: Application,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  return request(app)
    .post('/api/v1/channels/instagram/connect')
    .set(authHeader(token))
    .send({
      displayName: 'Instagram',
      instagramAccountId: IG.instagramAccountId,
      instagramUsername: IG.instagramUsername,
      facebookPageId: IG.facebookPageId,
      businessName: IG.businessName,
      accessToken: IG.accessToken,
      appSecret: IG.appSecret,
      verifyToken: IG.verifyToken,
      ...overrides,
    });
}

/** Meta X-Hub-Signature-256 over the exact raw body. */
export function igSign(rawBody: string, appSecret = IG.appSecret): string {
  return 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
}

/** GET verification handshake. */
export function igVerify(
  app: Application,
  channelAccountId: string,
  query: Record<string, string>,
) {
  return request(app)
    .get(`/api/v1/webhooks/instagram/${channelAccountId}`)
    .query(query);
}

/** POST a signed Meta Instagram webhook body (bad signature via opts). */
export function igWebhook(
  app: Application,
  channelAccountId: string,
  body: unknown,
  opts: { appSecret?: string; badSignature?: boolean; tamper?: boolean } = {},
) {
  const raw = JSON.stringify(body);
  const signed = opts.tamper ? raw + ' ' : raw;
  const sig = opts.badSignature
    ? 'sha256=deadbeef'
    : igSign(raw, opts.appSecret ?? IG.appSecret);
  return request(app)
    .post(`/api/v1/webhooks/instagram/${channelAccountId}`)
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', sig)
    .send(signed);
}

/** Build an Instagram inbound text-message webhook payload (Messenger shape). */
export function igTextPayload(opts: {
  mid: string;
  from?: string;
  text: string;
  recipient?: string;
  timestamp?: number;
}) {
  return {
    object: 'instagram',
    entry: [
      {
        id: opts.recipient ?? IG.instagramAccountId,
        time: 1710000000000,
        messaging: [
          {
            sender: { id: opts.from ?? IG.customerIgsid },
            recipient: { id: opts.recipient ?? IG.instagramAccountId },
            timestamp: opts.timestamp ?? 1710000000000,
            message: { mid: opts.mid, text: opts.text },
          },
        ],
      },
    ],
  };
}

/** Build an Instagram inbound text in the CHANGES format (Instagram Login). */
export function igChangesTextPayload(opts: {
  mid: string;
  from?: string;
  text: string;
  recipient?: string;
}) {
  return {
    object: 'instagram',
    entry: [
      {
        id: opts.recipient ?? IG.instagramAccountId,
        time: 1527459824,
        changes: [
          {
            field: 'messages',
            value: {
              sender: { id: opts.from ?? IG.customerIgsid },
              recipient: { id: opts.recipient ?? IG.instagramAccountId },
              timestamp: '1527459824', // seconds (Instagram Login format)
              message: { mid: opts.mid, text: opts.text },
            },
          },
        ],
      },
    ],
  };
}

/** Build an Instagram echo payload (business's own outbound copy). */
export function igEchoPayload(opts: { mid: string; text: string }) {
  return {
    object: 'instagram',
    entry: [
      {
        id: IG.instagramAccountId,
        messaging: [
          {
            sender: { id: IG.instagramAccountId },
            recipient: { id: IG.customerIgsid },
            timestamp: 1710000000000,
            message: { mid: opts.mid, text: opts.text, is_echo: true },
          },
        ],
      },
    ],
  };
}

/** Build an Instagram read-receipt payload. */
export function igReadPayload(opts: { mid: string }) {
  return {
    object: 'instagram',
    entry: [
      {
        id: IG.instagramAccountId,
        messaging: [
          {
            sender: { id: IG.customerIgsid },
            recipient: { id: IG.instagramAccountId },
            timestamp: 1710000000100,
            read: { mid: opts.mid },
          },
        ],
      },
    ],
  };
}

/** Build an Instagram unsupported (media attachment) payload. */
export function igAttachmentPayload(opts: { mid: string; type?: string }) {
  return {
    object: 'instagram',
    entry: [
      {
        id: IG.instagramAccountId,
        messaging: [
          {
            sender: { id: IG.customerIgsid },
            recipient: { id: IG.instagramAccountId },
            timestamp: 1710000000000,
            message: {
              mid: opts.mid,
              attachments: [
                { type: opts.type ?? 'image', payload: { url: 'https://example.test/x.jpg' } },
              ],
            },
          },
        ],
      },
    ],
  };
}
