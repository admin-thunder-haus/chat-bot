import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';
import { prisma } from './setup';
import {
  setMetaOauthConfigForTesting,
} from '../src/modules/channels/oauth/meta-oauth.service';
import {
  setMetaOauthTransportForTesting,
  type MetaOauthTransport,
} from '../src/modules/channels/oauth/meta-oauth.graph';
import {
  setFacebookTransportForTesting,
  setWhatsAppTransportForTesting,
} from '../src/modules/channels';
import { makeFacebookTransport } from './facebook-helpers';
import { makeWhatsAppTransport } from './whatsapp-helpers';

/**
 * Meta OAuth ASSET SELECTION.
 *
 * When an authorization grants more than one connectable asset, nothing may be
 * connected until the operator says which one. The previous behaviour — taking
 * the first Page / WABA / number Graph happened to return — silently wires a
 * live customer channel to the wrong brand, and an agency holding several
 * client Pages hits that on every single connect.
 *
 * Two independent protections are exercised throughout:
 *   1. a selection is scoped to the company that started the flow
 *   2. the chosen ids must appear in THAT selection's stored assets
 * Either one alone would be insufficient.
 */

const app = createApp();
let acme: Tenant;

const META = {
  appId: '1234567890',
  appSecret: 'test-meta-app-secret-abcdef',
  whatsappConfigId: 'wa-es-config-1',
  loginConfigId: 'login-config-1',
  frontendUrl: 'http://frontend.test',
};

const WA_BUSINESS_TOKEN = 'EAAB-business-token-0987654321';
const WABA_A = '5550001112223334';
const WABA_B = '5550009998887776';
const PHONE_A1 = '1029384756';
const PHONE_A2 = '1029384799';
const PHONE_B1 = '2938475610';

const PAGE_A = { id: '100000000000001', name: 'Acme Bakery', token: 'page-token-a' };
const PAGE_B = { id: '100000000000002', name: 'Acme Coffee', token: 'page-token-b' };

interface GraphOverrides {
  pages?: () => { status: number; ok: boolean; json: unknown };
  debug?: () => { status: number; ok: boolean; json: unknown };
  phones?: (wabaId: string) => { status: number; ok: boolean; json: unknown };
}

/** Graph fake granting TWO Pages (both Instagram-linked) and TWO WABAs. */
function multiAssetTransport(overrides: GraphOverrides = {}): MetaOauthTransport {
  return {
    async request(input) {
      if (input.url.includes('/oauth/access_token')) {
        return { status: 200, ok: true, json: { access_token: WA_BUSINESS_TOKEN } };
      }
      if (input.url.includes('/me/accounts')) {
        return (
          overrides.pages?.() ?? {
            status: 200,
            ok: true,
            json: {
              data: [
                {
                  id: PAGE_A.id,
                  name: PAGE_A.name,
                  access_token: PAGE_A.token,
                  instagram_business_account: { id: 'ig-a' },
                },
                {
                  id: PAGE_B.id,
                  name: PAGE_B.name,
                  access_token: PAGE_B.token,
                  instagram_business_account: { id: 'ig-b' },
                },
              ],
            },
          }
        );
      }
      if (input.url.includes('/debug_token')) {
        return (
          overrides.debug?.() ?? {
            status: 200,
            ok: true,
            json: {
              data: {
                granular_scopes: [
                  { scope: 'whatsapp_business_management', target_ids: [WABA_A] },
                  { scope: 'whatsapp_business_messaging', target_ids: [WABA_B] },
                ],
              },
            },
          }
        );
      }
      if (input.url.includes('/phone_numbers')) {
        const wabaId = input.url.includes(WABA_B) ? WABA_B : WABA_A;
        if (overrides.phones) return overrides.phones(wabaId);
        const data =
          wabaId === WABA_A
            ? [
                { id: PHONE_A1, display_phone_number: '+1 555 010 0000', verified_name: 'Acme Bakery WA' },
                { id: PHONE_A2, display_phone_number: '+1 555 010 0001', verified_name: 'Acme Bakery Support' },
              ]
            : [{ id: PHONE_B1, display_phone_number: '+1 555 020 0000', verified_name: 'Acme Coffee WA' }];
        return { status: 200, ok: true, json: { data } };
      }
      // WABA name lookup (`/{id}?fields=id,name`) and subscribed_apps.
      if (input.url.includes('/subscribed_apps')) {
        return { status: 200, ok: true, json: { success: true } };
      }
      if (input.url.includes(WABA_A) || input.url.includes(WABA_B)) {
        const name = input.url.includes(WABA_B) ? 'Acme Coffee Business' : 'Acme Bakery Business';
        return { status: 200, ok: true, json: { id: 'x', name } };
      }
      return { status: 404, ok: false, json: null };
    },
  };
}

beforeEach(async () => {
  acme = await setupTenant('acme');
  setMetaOauthConfigForTesting({ ...META });
  setFacebookTransportForTesting(makeFacebookTransport().transport);
  setWhatsAppTransportForTesting(makeWhatsAppTransport().transport);
  setMetaOauthTransportForTesting(multiAssetTransport());
});

afterEach(() => {
  setMetaOauthConfigForTesting(null);
  setMetaOauthTransportForTesting(null);
  setFacebookTransportForTesting(null);
  setWhatsAppTransportForTesting(null);
});

async function mintState(provider: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/channels/oauth/meta/start')
    .set(authHeader(acme.tokens.owner))
    .send({ provider });
  expect(res.status).toBe(200);
  return new URL(res.body.data.url).searchParams.get('state')!;
}

/** Drive the callback and return the selection id it redirected to. */
async function selectionFromCallback(provider: string): Promise<string> {
  const res = await request(app)
    .get('/api/v1/channels/oauth/meta/callback')
    .query({ code: `${provider}-code`, state: await mintState(provider) });
  expect(res.status).toBe(302);
  const location = res.headers.location as string;
  expect(location).toContain('/select?');
  expect(location).toContain(`provider=${provider}`);
  return new URL(location).searchParams.get('selection')!;
}

function getSelection(id: string, token = acme.tokens.owner) {
  return request(app)
    .get(`/api/v1/channels/oauth/meta/selection/${id}`)
    .set(authHeader(token));
}

function connectSelection(
  id: string,
  body: Record<string, unknown>,
  token = acme.tokens.owner,
) {
  return request(app)
    .post(`/api/v1/channels/oauth/meta/selection/${id}/connect`)
    .set(authHeader(token))
    .send(body);
}

function accountCount(companyId = acme.company.id) {
  return prisma.channelAccount.count({ where: { companyId } });
}

describe('multiple Facebook Pages', () => {
  it('connects NOTHING and redirects to the picker', async () => {
    const id = await selectionFromCallback('facebook');
    expect(id).toEqual(expect.any(String));
    expect(await accountCount()).toBe(0);
  });

  it('lists both Pages and never exposes a Page access token', async () => {
    const id = await selectionFromCallback('facebook');
    const res = await getSelection(id);

    expect(res.status).toBe(200);
    const { selection } = res.body.data;
    expect(selection.provider).toBe('facebook');
    expect(
      selection.pages.map((p: { pageId: string }) => p.pageId).sort(),
    ).toEqual([PAGE_A.id, PAGE_B.id].sort());
    expect(
      selection.pages.map((p: { pageName: string }) => p.pageName),
    ).toContain(PAGE_B.name);

    // The stored payload carries Page tokens; the projection must not.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(PAGE_A.token);
    expect(body).not.toContain(PAGE_B.token);
    expect(body).not.toContain(META.appSecret);
    expect(body).not.toContain(WA_BUSINESS_TOKEN);
  });

  it('connects ONLY the chosen Page', async () => {
    const id = await selectionFromCallback('facebook');
    const res = await connectSelection(id, { pageId: PAGE_B.id });

    expect(res.status).toBe(201);
    const accounts = await prisma.channelAccount.findMany({
      where: { companyId: acme.company.id },
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0].externalAccountId).toBe(PAGE_B.id);
    expect(accounts[0].displayName).toBe(PAGE_B.name);
  });

  it('is single-use — the same selection cannot be replayed', async () => {
    const id = await selectionFromCallback('facebook');
    expect((await connectSelection(id, { pageId: PAGE_A.id })).status).toBe(201);

    const replay = await connectSelection(id, { pageId: PAGE_B.id });
    expect(replay.status).toBe(404);
    expect(await accountCount()).toBe(1);
    expect((await getSelection(id)).status).toBe(404);
  });

  it('rejects a Page id that was not part of the grant', async () => {
    const id = await selectionFromCallback('facebook');
    const res = await connectSelection(id, { pageId: '999999999999999' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ASSET_NOT_IN_GRANT');
    expect(await accountCount()).toBe(0);

    // A rejected choice must NOT burn the selection — otherwise a typo would
    // force the operator through the whole Meta authorization again.
    expect((await connectSelection(id, { pageId: PAGE_A.id })).status).toBe(201);
  });

  it('rejects an expired selection', async () => {
    const id = await selectionFromCallback('facebook');
    await prisma.metaOauthSelection.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await getSelection(id)).status).toBe(404);
    expect((await connectSelection(id, { pageId: PAGE_A.id })).status).toBe(404);
    expect(await accountCount()).toBe(0);
  });

  it('requires OWNER/ADMIN and authentication', async () => {
    const id = await selectionFromCallback('facebook');
    expect((await getSelection(id, acme.tokens.agent)).status).toBe(403);
    expect(
      (await connectSelection(id, { pageId: PAGE_A.id }, acme.tokens.agent)).status,
    ).toBe(403);
    expect(
      (await request(app).get(`/api/v1/channels/oauth/meta/selection/${id}`)).status,
    ).toBe(401);
    expect(await accountCount()).toBe(0);
  });

  it('a single granted Page still connects in one click', async () => {
    setMetaOauthTransportForTesting(
      multiAssetTransport({
        pages: () => ({
          status: 200,
          ok: true,
          json: {
            data: [{ id: PAGE_A.id, name: PAGE_A.name, access_token: PAGE_A.token }],
          },
        }),
      }),
    );
    const res = await request(app)
      .get('/api/v1/channels/oauth/meta/callback')
      .query({ code: 'fb-code', state: await mintState('facebook') });

    expect(res.headers.location).toContain('connected=facebook');
    expect(await prisma.metaOauthSelection.count()).toBe(0);
    expect(await accountCount()).toBe(1);
  });
});

describe('tenant isolation', () => {
  it('another company cannot read or consume the selection', async () => {
    const id = await selectionFromCallback('facebook');
    const globex = await setupTenant('globex');

    // Holding the id is not enough: it is scoped to the company that started
    // the flow. The answer is "not found", never "forbidden", so the endpoint
    // cannot be used to probe which selection ids exist.
    expect((await getSelection(id, globex.tokens.owner)).status).toBe(404);
    expect(
      (await connectSelection(id, { pageId: PAGE_A.id }, globex.tokens.owner)).status,
    ).toBe(404);

    // Nothing connected for either tenant, and the selection survives intact
    // for its rightful owner — a failed probe must not burn it.
    expect(await prisma.channelAccount.count()).toBe(0);
    expect((await getSelection(id, acme.tokens.owner)).status).toBe(200);
  });

  it('the connected account belongs to the company that authorized it', async () => {
    const id = await selectionFromCallback('facebook');
    const globex = await setupTenant('globex');
    expect((await connectSelection(id, { pageId: PAGE_A.id })).status).toBe(201);

    const all = await prisma.channelAccount.findMany({
      select: { companyId: true, externalAccountId: true },
    });
    expect(all).toHaveLength(1);
    expect(all[0].companyId).toBe(acme.company.id);
    expect(await accountCount(globex.company.id)).toBe(0);
  });

  it('a selection is scoped even when both tenants have one pending', async () => {
    const acmeId = await selectionFromCallback('facebook');

    const globex = await setupTenant('globex');
    const globexStart = await request(app)
      .post('/api/v1/channels/oauth/meta/start')
      .set(authHeader(globex.tokens.owner))
      .send({ provider: 'facebook' });
    const globexCallback = await request(app)
      .get('/api/v1/channels/oauth/meta/callback')
      .query({
        code: 'fb-code',
        state: new URL(globexStart.body.data.url).searchParams.get('state')!,
      });
    const globexId = new URL(globexCallback.headers.location as string).searchParams.get(
      'selection',
    )!;
    expect(globexId).not.toBe(acmeId);

    // Each tenant sees only its own.
    expect((await getSelection(acmeId, acme.tokens.owner)).status).toBe(200);
    expect((await getSelection(globexId, acme.tokens.owner)).status).toBe(404);
    expect((await getSelection(acmeId, globex.tokens.owner)).status).toBe(404);
    expect((await getSelection(globexId, globex.tokens.owner)).status).toBe(200);

    // Each connect lands in the right tenant.
    expect((await connectSelection(acmeId, { pageId: PAGE_A.id })).status).toBe(201);
    expect(
      (await connectSelection(globexId, { pageId: PAGE_B.id }, globex.tokens.owner)).status,
    ).toBe(201);

    const acmeAccounts = await prisma.channelAccount.findMany({
      where: { companyId: acme.company.id },
      select: { externalAccountId: true },
    });
    const globexAccounts = await prisma.channelAccount.findMany({
      where: { companyId: globex.company.id },
      select: { externalAccountId: true },
    });
    expect(acmeAccounts).toEqual([{ externalAccountId: PAGE_A.id }]);
    expect(globexAccounts).toEqual([{ externalAccountId: PAGE_B.id }]);
  });
});

describe('multiple Instagram accounts', () => {
  it('offers the linked Pages and connects the chosen one', async () => {
    const id = await selectionFromCallback('instagram');
    const res = await getSelection(id);

    expect(res.status).toBe(200);
    expect(res.body.data.selection.provider).toBe('instagram');
    expect(
      res.body.data.selection.pages.map(
        (p: { instagramAccountId: string }) => p.instagramAccountId,
      ),
    ).toEqual(expect.arrayContaining(['ig-a', 'ig-b']));

    expect((await connectSelection(id, { pageId: PAGE_B.id })).status).toBe(201);
    const account = await prisma.channelAccount.findFirst({
      where: { companyId: acme.company.id, providerKey: 'instagram' },
    });
    expect(account?.externalAccountId).toBe('ig-b');
  });

  it('offers ONLY Instagram-linked Pages, so one linked Page is one click', async () => {
    // Two Pages, only one with Instagram: unambiguous for the Instagram flow.
    setMetaOauthTransportForTesting(
      multiAssetTransport({
        pages: () => ({
          status: 200,
          ok: true,
          json: {
            data: [
              { id: PAGE_A.id, name: PAGE_A.name, access_token: PAGE_A.token },
              {
                id: PAGE_B.id,
                name: PAGE_B.name,
                access_token: PAGE_B.token,
                instagram_business_account: { id: 'ig-b' },
              },
            ],
          },
        }),
      }),
    );
    const res = await request(app)
      .get('/api/v1/channels/oauth/meta/callback')
      .query({ code: 'ig-code', state: await mintState('instagram') });

    expect(res.headers.location).toContain('connected=instagram');
    const account = await prisma.channelAccount.findFirst({
      where: { companyId: acme.company.id, providerKey: 'instagram' },
    });
    expect(account?.externalAccountId).toBe('ig-b');
  });
});

describe('multiple WhatsApp Business Accounts and numbers', () => {
  it('lists every WABA with its numbers and never leaks the business token', async () => {
    const id = await selectionFromCallback('whatsapp');
    expect(await accountCount()).toBe(0);

    const res = await getSelection(id);
    expect(res.status).toBe(200);
    const { wabas } = res.body.data.selection;
    expect(wabas.map((w: { wabaId: string }) => w.wabaId).sort()).toEqual(
      [WABA_A, WABA_B].sort(),
    );
    const a = wabas.find((w: { wabaId: string }) => w.wabaId === WABA_A);
    expect(a.phones.map((p: { phoneNumberId: string }) => p.phoneNumberId)).toEqual([
      PHONE_A1,
      PHONE_A2,
    ]);
    expect(JSON.stringify(res.body)).not.toContain(WA_BUSINESS_TOKEN);
  });

  it('connects only the chosen (WABA, number) pair', async () => {
    const id = await selectionFromCallback('whatsapp');
    const res = await connectSelection(id, {
      wabaId: WABA_B,
      phoneNumberId: PHONE_B1,
    });

    expect(res.status).toBe(201);
    const accounts = await prisma.channelAccount.findMany({
      where: { companyId: acme.company.id, providerKey: 'whatsapp' },
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0].externalPageId).toBe(WABA_B);
    expect(accounts[0].externalAccountId).toBe(PHONE_B1);
  });

  it('treats a second number on one WABA as a real choice', async () => {
    // One WABA, two numbers: still ambiguous, so still a picker.
    setMetaOauthTransportForTesting(
      multiAssetTransport({
        debug: () => ({
          status: 200,
          ok: true,
          json: {
            data: {
              granular_scopes: [
                { scope: 'whatsapp_business_management', target_ids: [WABA_A] },
              ],
            },
          },
        }),
      }),
    );
    const id = await selectionFromCallback('whatsapp');
    const res = await getSelection(id);
    expect(res.body.data.selection.wabas).toHaveLength(1);
    expect(res.body.data.selection.wabas[0].phones).toHaveLength(2);

    expect(
      (await connectSelection(id, { wabaId: WABA_A, phoneNumberId: PHONE_A2 })).status,
    ).toBe(201);
    const account = await prisma.channelAccount.findFirst({
      where: { companyId: acme.company.id, providerKey: 'whatsapp' },
    });
    expect(account?.externalAccountId).toBe(PHONE_A2);
  });

  it('requires BOTH wabaId and phoneNumberId', async () => {
    const id = await selectionFromCallback('whatsapp');
    expect((await connectSelection(id, { wabaId: WABA_A })).status).toBe(400);
    expect((await connectSelection(id, { pageId: PAGE_A.id })).status).toBe(400);
    expect(await accountCount()).toBe(0);
  });

  it('rejects a WABA that was not part of the grant', async () => {
    const id = await selectionFromCallback('whatsapp');
    const res = await connectSelection(id, {
      wabaId: '1111111111111111',
      phoneNumberId: PHONE_A1,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ASSET_NOT_IN_GRANT');
    expect(await accountCount()).toBe(0);
  });

  it('rejects a number belonging to a DIFFERENT granted WABA', async () => {
    // Both ids are individually real; the pair is not. Matching them
    // independently would have let this through.
    const id = await selectionFromCallback('whatsapp');
    const res = await connectSelection(id, {
      wabaId: WABA_B,
      phoneNumberId: PHONE_A1,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ASSET_NOT_IN_GRANT');
    expect(await accountCount()).toBe(0);
  });

  it('one WABA with one number still connects in one click', async () => {
    setMetaOauthTransportForTesting(
      multiAssetTransport({
        debug: () => ({
          status: 200,
          ok: true,
          json: {
            data: {
              granular_scopes: [
                { scope: 'whatsapp_business_management', target_ids: [WABA_B] },
              ],
            },
          },
        }),
      }),
    );
    const res = await request(app)
      .get('/api/v1/channels/oauth/meta/callback')
      .query({ code: 'wa-code', state: await mintState('whatsapp') });

    expect(res.headers.location).toContain('connected=whatsapp');
    expect(await prisma.metaOauthSelection.count()).toBe(0);
    const account = await prisma.channelAccount.findFirst({
      where: { companyId: acme.company.id, providerKey: 'whatsapp' },
    });
    expect(account?.externalPageId).toBe(WABA_B);
  });

  it('the Embedded Signup popup returns a selection instead of guessing', async () => {
    const res = await request(app)
      .post('/api/v1/channels/oauth/meta/whatsapp/complete')
      .set(authHeader(acme.tokens.owner))
      .send({ code: 'es-multi' });

    expect(res.status).toBe(200);
    expect(res.body.data.requiresSelection).toBe(true);
    expect(res.body.data.selection.wabas).toHaveLength(2);
    expect(await accountCount()).toBe(0);

    // And that selection drives the same picker endpoints.
    const connected = await connectSelection(res.body.data.selection.id, {
      wabaId: WABA_A,
      phoneNumberId: PHONE_A1,
    });
    expect(connected.status).toBe(201);
  });
});

describe('stored selection payload', () => {
  it('is encrypted at rest — no token or asset id is readable in the row', async () => {
    const id = await selectionFromCallback('facebook');

    const row = await prisma.metaOauthSelection.findUniqueOrThrow({ where: { id } });
    expect(row.companyId).toBe(acme.company.id);
    expect(row.provider).toBe('facebook');
    expect(row.consumedAt).toBeNull();
    expect(row.encryptionVersion).toBeTruthy();
    expect(row.encryptedPayload).not.toContain(PAGE_A.token);
    expect(row.encryptedPayload).not.toContain(PAGE_A.id);
    expect(row.encryptedPayload).not.toContain(WA_BUSINESS_TOKEN);
  });

  it('is deleted with its company', async () => {
    const id = await selectionFromCallback('facebook');
    await prisma.company.delete({ where: { id: acme.company.id } });
    expect(await prisma.metaOauthSelection.count({ where: { id } })).toBe(0);
  });
});
