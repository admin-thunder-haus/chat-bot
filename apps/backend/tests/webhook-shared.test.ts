import { createHmac } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, type Tenant } from './helpers';
import { drainJobs } from './jobs-helpers';
import { prisma } from './setup';
import { env } from '../src/config/env';
import {
  setFacebookTransportForTesting,
  setWhatsAppTransportForTesting,
} from '../src/modules/channels';
import { makeFacebookTransport, FB, connectFacebook } from './facebook-helpers';
import { makeWhatsAppTransport } from './whatsapp-helpers';

/**
 * SHARED webhook endpoint — /api/v1/webhooks/:providerKey, no account id.
 *
 * A Meta app has exactly ONE callback URL for every customer it serves, so with
 * one-click connect the account cannot come from the URL. It is resolved from
 * the ids inside the payload instead. The property that matters most here is
 * tenant isolation: one POST may carry entries for several tenants, and each
 * must be parsed only under its own account.
 */

const app = createApp();

const PLATFORM_SECRET = 'test-platform-app-secret-shared';
const VERIFY_TOKEN = 'test-platform-verify-token-shared';

let acme: Tenant;

function sign(rawBody: string, secret = PLATFORM_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

/** POST a payload to the shared endpoint, signed with the platform secret. */
function postShared(
  provider: string,
  payload: unknown,
  opts: { secret?: string; signature?: string } = {},
) {
  const raw = JSON.stringify(payload);
  const req = request(app)
    .post(`/api/v1/webhooks/${provider}`)
    .set('Content-Type', 'application/json');
  const sig = opts.signature ?? sign(raw, opts.secret ?? PLATFORM_SECRET);
  return req.set('X-Hub-Signature-256', sig).send(raw);
}

/** A Messenger inbound entry for a given Page. */
function messengerEntry(pageId: string, senderId: string, mid: string, text: string) {
  return {
    id: pageId,
    time: Date.now(),
    messaging: [
      {
        sender: { id: senderId },
        recipient: { id: pageId },
        timestamp: Date.now(),
        message: { mid, text },
      },
    ],
  };
}

beforeEach(async () => {
  acme = await setupTenant('acme');
  setFacebookTransportForTesting(makeFacebookTransport().transport);
  setWhatsAppTransportForTesting(makeWhatsAppTransport().transport);
  env.META_APP_SECRET = PLATFORM_SECRET;
  env.META_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;
});

afterEach(() => {
  setFacebookTransportForTesting(null);
  setWhatsAppTransportForTesting(null);
  env.META_APP_SECRET = undefined;
  env.META_WEBHOOK_VERIFY_TOKEN = undefined;
});

/** Connect a Facebook Page for a tenant and return its channel account id. */
async function connectPage(tenant: Tenant, pageId: string): Promise<string> {
  const res = await connectFacebook(app, tenant.tokens.owner, {
    pageId,
    appSecret: PLATFORM_SECRET,
  });
  expect(res.status).toBe(201);
  return res.body.data.account.id as string;
}

describe('GET verification', () => {
  it('echoes the challenge for the platform verify token', async () => {
    const res = await request(app)
      .get('/api/v1/webhooks/facebook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': 'challenge-12345',
      });
    expect(res.status).toBe(200);
    expect(res.text).toBe('challenge-12345');
  });

  it('rejects a wrong verify token', async () => {
    const res = await request(app)
      .get('/api/v1/webhooks/facebook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'not-the-token',
        'hub.challenge': 'challenge-12345',
      });
    expect(res.status).toBe(403);
  });

  it('stays closed while the platform token is unset', async () => {
    env.META_WEBHOOK_VERIFY_TOKEN = undefined;
    const res = await request(app)
      .get('/api/v1/webhooks/facebook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': 'x',
      });
    // A shared webhook that verifies against nothing would let anyone subscribe.
    expect(res.status).toBe(403);
  });

  it('is not offered for providers that stay per-account', async () => {
    const res = await request(app)
      .get('/api/v1/webhooks/telegram')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN });
    expect(res.status).toBe(404);
  });
});

describe('signature', () => {
  it('rejects a payload signed with the wrong secret', async () => {
    await connectPage(acme, FB.pageId);
    const res = await postShared(
      'facebook',
      { object: 'page', entry: [messengerEntry(FB.pageId, 'psid-1', 'm-bad', 'hi')] },
      { secret: 'some-other-secret' },
    );
    expect(res.status).toBe(401);
    expect(await prisma.message.count({ where: { companyId: acme.company.id } })).toBe(0);
  });

  it('rejects a missing signature', async () => {
    await connectPage(acme, FB.pageId);
    const res = await request(app)
      .post('/api/v1/webhooks/facebook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ object: 'page', entry: [] }));
    expect(res.status).toBe(401);
  });

  it('refuses to serve at all while the platform secret is unset', async () => {
    env.META_APP_SECRET = undefined;
    const res = await postShared('facebook', { object: 'page', entry: [] });
    // Never accept unsigned traffic on a URL that fans out to every tenant.
    expect(res.status).toBe(404);
  });
});

describe('routing to the right tenant', () => {
  it('delivers an inbound message to the account owning that Page', async () => {
    await connectPage(acme, FB.pageId);

    const res = await postShared('facebook', {
      object: 'page',
      entry: [messengerEntry(FB.pageId, 'psid-acme', 'mid-1', 'hello acme')],
    });
    expect(res.status).toBe(200);
    await drainJobs();

    const messages = await prisma.message.findMany({
      where: { companyId: acme.company.id, direction: 'INBOUND' },
      select: { content: true },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('hello acme');
  });

  it('splits a batched payload so each tenant gets ONLY its own entry', async () => {
    // The property this whole endpoint exists for. Meta batches entries, and a
    // single POST can carry two customers' messages; handing the whole payload
    // to one account would attribute the other's messages to it.
    const globex = await setupTenant('globex');
    const acmePage = FB.pageId;
    const globexPage = '100000000000999';
    await connectPage(acme, acmePage);
    await connectPage(globex, globexPage);

    const res = await postShared('facebook', {
      object: 'page',
      entry: [
        messengerEntry(acmePage, 'psid-a', 'mid-acme', 'for acme'),
        messengerEntry(globexPage, 'psid-g', 'mid-globex', 'for globex'),
      ],
    });
    expect(res.status).toBe(200);
    await drainJobs();

    const acmeMsgs = await prisma.message.findMany({
      where: { companyId: acme.company.id, direction: 'INBOUND' },
      select: { content: true },
    });
    const globexMsgs = await prisma.message.findMany({
      where: { companyId: globex.company.id, direction: 'INBOUND' },
      select: { content: true },
    });

    expect(acmeMsgs.map((m) => m.content)).toEqual(['for acme']);
    expect(globexMsgs.map((m) => m.content)).toEqual(['for globex']);
  });

  it('ignores an entry for a Page nobody connected, without failing the rest', async () => {
    await connectPage(acme, FB.pageId);

    const res = await postShared('facebook', {
      object: 'page',
      entry: [
        messengerEntry('999999999999999', 'psid-x', 'mid-orphan', 'nobody owns me'),
        messengerEntry(FB.pageId, 'psid-a', 'mid-ok', 'for acme'),
      ],
    });
    // Acknowledged: an error would make Meta retry forever and eventually
    // disable the subscription for every other tenant too.
    expect(res.status).toBe(200);
    expect(res.body.data.ignored).toBeGreaterThanOrEqual(1);
    await drainJobs();

    const contents = (
      await prisma.message.findMany({
        where: { direction: 'INBOUND' },
        select: { content: true },
      })
    ).map((m) => m.content);
    expect(contents).toEqual(['for acme']);
  });

  it('does not deliver to a disabled channel', async () => {
    const id = await connectPage(acme, FB.pageId);
    await prisma.channelAccount.update({
      where: { id },
      data: { isEnabled: false },
    });

    const res = await postShared('facebook', {
      object: 'page',
      entry: [messengerEntry(FB.pageId, 'psid-a', 'mid-disabled', 'ignored')],
    });
    expect(res.status).toBe(200);
    await drainJobs();
    expect(await prisma.message.count({ where: { direction: 'INBOUND' } })).toBe(0);
  });

  it('is idempotent — a redelivered entry does not duplicate the message', async () => {
    await connectPage(acme, FB.pageId);
    const payload = {
      object: 'page',
      entry: [messengerEntry(FB.pageId, 'psid-a', 'mid-dupe', 'only once')],
    };

    expect((await postShared('facebook', payload)).status).toBe(200);
    await drainJobs();
    expect((await postShared('facebook', payload)).status).toBe(200);
    await drainJobs();

    expect(
      await prisma.message.count({
        where: { companyId: acme.company.id, direction: 'INBOUND' },
      }),
    ).toBe(1);
  });
});

describe('the per-account endpoint is untouched', () => {
  it('still accepts events on its own URL with the account app secret', async () => {
    // The manual flow must keep working exactly as before: a customer with
    // their own Meta app keeps their own URL and their own secret.
    const res = await connectFacebook(app, acme.tokens.owner, {
      pageId: FB.pageId,
      appSecret: FB.appSecret,
    });
    expect(res.status).toBe(201);
    const accountId = res.body.data.account.id as string;

    const payload = {
      object: 'page',
      entry: [messengerEntry(FB.pageId, 'psid-manual', 'mid-manual', 'manual path')],
    };
    const raw = JSON.stringify(payload);
    const posted = await request(app)
      .post(`/api/v1/webhooks/facebook/${accountId}`)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(raw, FB.appSecret))
      .send(raw);

    expect(posted.status).toBe(200);
    await drainJobs();
    const messages = await prisma.message.findMany({
      where: { companyId: acme.company.id, direction: 'INBOUND' },
      select: { content: true },
    });
    expect(messages.map((m) => m.content)).toEqual(['manual path']);
  });
});
