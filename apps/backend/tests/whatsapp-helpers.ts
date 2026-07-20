import { createHmac } from 'node:crypto';
import request from 'supertest';
import type { Application } from 'express';
import { authHeader } from './helpers';
import type { WhatsAppTransport } from '../src/modules/channels';

/** Known test credentials (never real). */
export const WA = {
  phoneNumberId: '1111111111',
  wabaId: '2222222222',
  accessToken: 'EAA-test-access-token-1234567890',
  appSecret: 'test-app-secret-abcdef',
  verifyToken: 'test-verify-token-xyz',
  displayPhoneNumber: '+1 555 010 0000',
  businessName: 'Acme WA',
};

/**
 * A scriptable fake Meta transport so tests never hit the network. `sendResult`
 * and `checkResult` can be overridden to simulate 401/429/5xx/etc.
 */
export function makeWhatsAppTransport(
  overrides: {
    send?: () => { status: number; ok: boolean; json: unknown };
    check?: () => { status: number; ok: boolean; json: unknown };
  } = {},
): { transport: WhatsAppTransport; calls: { method: string; url: string }[] } {
  const calls: { method: string; url: string }[] = [];
  const transport: WhatsAppTransport = {
    async request(input) {
      calls.push({ method: input.method, url: input.url });
      if (input.method === 'POST') {
        return (
          overrides.send?.() ?? {
            status: 200,
            ok: true,
            json: { messages: [{ id: `wamid.OUT.${Date.now()}` }] },
          }
        );
      }
      return (
        overrides.check?.() ?? {
          status: 200,
          ok: true,
          json: {
            display_phone_number: WA.displayPhoneNumber,
            verified_name: WA.businessName,
          },
        }
      );
    },
  };
  return { transport, calls };
}

/** Connect a WhatsApp channel via the API; returns the account view. */
export function connectWhatsApp(
  app: Application,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  return request(app)
    .post('/api/v1/channels/whatsapp/connect')
    .set(authHeader(token))
    .send({
      displayName: 'WhatsApp',
      phoneNumberId: WA.phoneNumberId,
      wabaId: WA.wabaId,
      displayPhoneNumber: WA.displayPhoneNumber,
      businessName: WA.businessName,
      accessToken: WA.accessToken,
      appSecret: WA.appSecret,
      verifyToken: WA.verifyToken,
      ...overrides,
    });
}

/** Meta X-Hub-Signature-256 over the exact raw body. */
export function waSign(rawBody: string, appSecret = WA.appSecret): string {
  return 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
}

/** GET verification handshake. */
export function waVerify(
  app: Application,
  channelAccountId: string,
  query: Record<string, string>,
) {
  return request(app)
    .get(`/api/v1/webhooks/whatsapp/${channelAccountId}`)
    .query(query);
}

/** POST a signed Meta webhook body (bad signature via opts). */
export function waWebhook(
  app: Application,
  channelAccountId: string,
  body: unknown,
  opts: { appSecret?: string; badSignature?: boolean } = {},
) {
  const raw = JSON.stringify(body);
  const sig = opts.badSignature
    ? 'sha256=deadbeef'
    : waSign(raw, opts.appSecret ?? WA.appSecret);
  return request(app)
    .post(`/api/v1/webhooks/whatsapp/${channelAccountId}`)
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', sig)
    .send(raw);
}

/** Build a Meta inbound text-message payload. */
export function metaTextPayload(opts: {
  wamid: string;
  from: string;
  text: string;
  name?: string;
  phoneNumberId?: string;
}) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: WA.wabaId,
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: WA.displayPhoneNumber,
                phone_number_id: opts.phoneNumberId ?? WA.phoneNumberId,
              },
              contacts: [
                { profile: { name: opts.name ?? 'Ada Lovelace' }, wa_id: opts.from },
              ],
              messages: [
                {
                  from: opts.from,
                  id: opts.wamid,
                  timestamp: '1710000000',
                  type: 'text',
                  text: { body: opts.text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/** Build a Meta status payload (sent/delivered/read/failed). */
export function metaStatusPayload(opts: {
  wamid: string;
  status: string;
  recipient?: string;
}) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: WA.wabaId,
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: WA.displayPhoneNumber,
                phone_number_id: WA.phoneNumberId,
              },
              statuses: [
                {
                  id: opts.wamid,
                  status: opts.status,
                  timestamp: '1710000100',
                  recipient_id: opts.recipient ?? '15551230000',
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
