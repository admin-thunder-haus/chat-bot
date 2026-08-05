import { createHmac } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';
import { drainJobs } from './jobs-helpers';
import { prisma } from './setup';
import { env } from '../src/config/env';
import {
  setInstagramTransportForTesting,
  type InstagramTransport,
} from '../src/modules/channels';
import { connectInstagram, igChangesTextPayload, IG } from './instagram-helpers';

/**
 * Instagram provider behaviour that is specific to the Instagram Login model.
 *
 * Both properties here were previously wrong in ways that produce NO visible
 * error: a webhook verified with the Facebook secret is answered 401 and Meta
 * simply stops, and a readiness probe comparing against the Facebook app id
 * reports a correctly-subscribed account as broken. Silence and false alarms
 * are exactly the two failure modes worth pinning down.
 */

const app = createApp();

const FB_PLATFORM_SECRET = 'test-facebook-platform-secret';
const IG_PLATFORM_SECRET = 'test-instagram-platform-secret';
const VERIFY_TOKEN = 'test-platform-verify-token-shared';
const FB_APP_ID = 'fb-app-111';

let acme: Tenant;

function sign(rawBody: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

function postShared(payload: unknown, secret: string) {
  const raw = JSON.stringify(payload);
  return request(app)
    .post('/api/v1/webhooks/instagram')
    .set('Content-Type', 'application/json')
    .set('X-Hub-Signature-256', sign(raw, secret))
    .send(raw);
}

/**
 * Provider transport whose `subscribed_apps` GET returns the given FIELDS.
 *
 * Fields, not app ids: `/me/subscribed_apps` on graph.instagram.com resolves
 * from our own token, so every entry is already ours and the id it carries is
 * Instagram-scoped — it never equals the Instagram App ID. Verified against a
 * live account, where the real response was
 * `{"data":[{"id":"180553…","subscribed_fields":["messages"]}]}` while the
 * configured app id was `156676…`.
 */
function transportWithFields(fields: string[] | null): InstagramTransport {
  return {
    async request(input) {
      if (input.url.includes('/subscribed_apps')) {
        if (input.method === 'POST') {
          return { status: 200, ok: true, json: { success: true } };
        }
        if (fields === null) {
          return { status: 400, ok: false, json: { error: { code: 100 } } };
        }
        return {
          status: 200,
          ok: true,
          json: {
            data:
              fields.length === 0
                ? []
                : [{ id: 'instagram-scoped-id', subscribed_fields: fields }],
          },
        };
      }
      return {
        status: 200,
        ok: true,
        json: { id: IG.instagramAccountId, username: IG.instagramUsername },
      };
    },
  };
}

beforeEach(async () => {
  acme = await setupTenant('acme');
  setInstagramTransportForTesting(transportWithFields(['messages']));
  env.META_APP_SECRET = FB_PLATFORM_SECRET;
  env.META_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;
  // Both, because the readiness default reads process.env directly: the point
  // of these tests is that a fully-configured Facebook identity is still never
  // what Instagram is judged against.
  env.META_APP_ID = FB_APP_ID;
  process.env.META_APP_ID = FB_APP_ID;
});

afterEach(() => {
  setInstagramTransportForTesting(null);
  env.META_APP_SECRET = undefined;
  env.META_WEBHOOK_VERIFY_TOKEN = undefined;
  env.META_APP_ID = undefined;
  delete process.env.META_APP_ID;
  env.INSTAGRAM_APP_SECRET = undefined;
  env.INSTAGRAM_APP_ID = undefined;
});

/** Connect an Instagram account keyed so shared routing can find it. */
async function connect(): Promise<string> {
  const res = await connectInstagram(app, acme.tokens.owner);
  expect(res.status).toBe(201);
  return res.body.data.account.id as string;
}

async function healthCheck(accountId: string) {
  return request(app)
    .post(`/api/v1/channels/${accountId}/health-check`)
    .set(authHeader(acme.tokens.owner));
}

describe('Instagram shared webhook — signed with the INSTAGRAM app secret', () => {
  it('accepts a payload signed with INSTAGRAM_APP_SECRET', async () => {
    env.INSTAGRAM_APP_SECRET = IG_PLATFORM_SECRET;
    await connect();

    const res = await postShared(
      igChangesTextPayload({ mid: 'ig.login.1', text: 'hello from IG' }),
      IG_PLATFORM_SECRET,
    );
    expect(res.status).toBe(200);
    await drainJobs();

    const message = await prisma.message.findFirst({
      where: { externalMessageId: 'ig.login.1' },
    });
    expect(message).not.toBeNull();
    expect(message!.content).toBe('hello from IG');
  });

  it('rejects one signed with the FACEBOOK secret once the IG secret is set', async () => {
    // The original bug in reverse: with only META_APP_SECRET consulted, every
    // genuine Instagram notification failed and nothing said so.
    env.INSTAGRAM_APP_SECRET = IG_PLATFORM_SECRET;
    await connect();

    const res = await postShared(
      igChangesTextPayload({ mid: 'ig.login.2', text: 'wrong secret' }),
      FB_PLATFORM_SECRET,
    );
    expect(res.status).toBe(401);
    await drainJobs();
    expect(
      await prisma.message.count({ where: { externalMessageId: 'ig.login.2' } }),
    ).toBe(0);
  });

  it('falls back to META_APP_SECRET when no Instagram secret is configured', async () => {
    // Deployments that have not set the Instagram secret yet keep working
    // exactly as before rather than losing Instagram entirely.
    await connect();

    const res = await postShared(
      igChangesTextPayload({ mid: 'ig.login.3', text: 'fallback' }),
      FB_PLATFORM_SECRET,
    );
    expect(res.status).toBe(200);
    await drainJobs();
    expect(
      await prisma.message.count({ where: { externalMessageId: 'ig.login.3' } }),
    ).toBe(1);
  });
});

describe('Instagram inbound readiness — judged by the subscribed FIELDS', () => {
  it('reports ready when the account is subscribed to messages', async () => {
    const id = await connect();
    const res = await healthCheck(id);
    expect(res.status).toBe(200);
    expect(res.body.data.account.inbound.ready).toBe(true);
  });

  it('does not compare app ids at all (the false-alarm regression)', async () => {
    // A correctly-subscribed live account reported APP_NOT_SUBSCRIBED because
    // Meta's Instagram-scoped id was compared to the Instagram App ID. Neither
    // configured id may change the verdict now.
    env.INSTAGRAM_APP_ID = 'some-other-id';
    process.env.META_APP_ID = 'yet-another-id';
    const id = await connect();
    const res = await healthCheck(id);
    expect(res.body.data.account.inbound.ready).toBe(true);
  });

  it('reports ready even with no INSTAGRAM_APP_ID configured', async () => {
    env.INSTAGRAM_APP_ID = undefined;
    const id = await connect();
    const res = await healthCheck(id);
    expect(res.body.data.account.inbound.ready).toBe(true);
  });

  it('reports NOT ready when nothing is subscribed', async () => {
    setInstagramTransportForTesting(transportWithFields([]));
    const id = await connect();
    const res = await healthCheck(id);
    expect(res.body.data.account.inbound.ready).toBe(false);
    expect(res.body.data.account.inbound.detail).toBe('NO_SUBSCRIBERS');
  });

  it('reports NOT ready when subscribed to other fields but not messages', async () => {
    // Subscribed, but to comments only — it would still receive no DMs.
    setInstagramTransportForTesting(transportWithFields(['comments']));
    const id = await connect();
    const res = await healthCheck(id);
    expect(res.body.data.account.inbound.ready).toBe(false);
    expect(res.body.data.account.inbound.detail).toBe(
      'MESSAGES_FIELD_NOT_SUBSCRIBED',
    );
  });

  it('stays THREE-VALUED: unknown when the probe cannot answer', async () => {
    setInstagramTransportForTesting(transportWithFields(null));
    const id = await connect();
    const res = await healthCheck(id);
    expect(res.body.data.account.inbound.ready).toBeNull();
  });

  it('probes `me`, not a stored id, on graph.instagram.com', async () => {
    const calls: { method: string; url: string }[] = [];
    setInstagramTransportForTesting({
      async request(input) {
        calls.push({ method: input.method, url: input.url });
        if (input.url.includes('/subscribed_apps')) {
          return { status: 200, ok: true, json: { data: [] } };
        }
        return { status: 200, ok: true, json: { id: IG.instagramAccountId } };
      },
    });
    const id = await connect();
    await healthCheck(id);

    const probes = calls.filter((c) => c.url.includes('/subscribed_apps'));
    expect(probes).not.toHaveLength(0);
    expect(probes.every((c) => c.url.includes('/me/subscribed_apps'))).toBe(true);
    expect(probes.every((c) => c.url.includes('graph.instagram.com'))).toBe(true);
    expect(probes.some((c) => c.url.includes(IG.facebookPageId))).toBe(false);
  });
});
