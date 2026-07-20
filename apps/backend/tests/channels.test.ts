import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';
import { createFakeChannel } from './channel-helpers';
import { prisma } from './setup';

const app = createApp();
let acme: Tenant;
let globex: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
});

describe('Channel accounts API', () => {
  it('lists the provider catalog (all roles), fake available + future coming soon', async () => {
    const res = await request(app)
      .get('/api/v1/channels/providers')
      .set(authHeader(acme.tokens.agent));
    expect(res.status).toBe(200);
    const keys = res.body.data.providers.map((p: { key: string }) => p.key);
    expect(keys).toContain('fake');
    expect(keys).toEqual(
      expect.arrayContaining(['whatsapp', 'instagram', 'facebook', 'telegram', 'webchat']),
    );
    const fake = res.body.data.providers.find((p: { key: string }) => p.key === 'fake');
    expect(fake.available).toBe(true);
  });

  it('OWNER and ADMIN can create a fake channel account', async () => {
    const owner = await createFakeChannel(app, acme.tokens.owner, {
      displayName: 'Owner Fake',
    });
    expect(owner.status).toBe(201);
    expect(owner.body.data.account.providerKey).toBe('fake');
    expect(owner.body.data.account.status).toBe('CONNECTED');

    const admin = await createFakeChannel(app, acme.tokens.admin, {
      displayName: 'Admin Fake',
      externalAccountId: 'fake-acct-2',
    });
    expect(admin.status).toBe(201);
  });

  it('AGENT cannot create a channel account but can view them', async () => {
    const create = await createFakeChannel(app, acme.tokens.agent);
    expect(create.status).toBe(403);

    await createFakeChannel(app, acme.tokens.owner);
    const list = await request(app)
      .get('/api/v1/channels')
      .set(authHeader(acme.tokens.agent));
    expect(list.status).toBe(200);
    expect(list.body.data.accounts.length).toBe(1);
  });

  it('rejects creating a not-yet-available (real) provider', async () => {
    const res = await request(app)
      .post('/api/v1/channels')
      .set(authHeader(acme.tokens.owner))
      .send({ providerKey: 'instagram', displayName: 'IG' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not available yet/i);
  });

  it('rejects generic create for a credentialed provider (must use connect)', async () => {
    const res = await request(app)
      .post('/api/v1/channels')
      .set(authHeader(acme.tokens.owner))
      .send({ providerKey: 'whatsapp', displayName: 'WA' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/connect flow/i);
  });

  it('rejects a client-supplied companyId (strict schema)', async () => {
    const res = await request(app)
      .post('/api/v1/channels')
      .set(authHeader(acme.tokens.owner))
      .send({
        providerKey: 'fake',
        displayName: 'X',
        companyId: globex.company.id,
      });
    expect(res.status).toBe(400);
  });

  it('never returns credential fields', async () => {
    const created = await createFakeChannel(app, acme.tokens.owner);
    expect(JSON.stringify(created.body)).not.toContain('encryptedPayload');
    expect(created.body.data.account.credential).toBeUndefined();

    const got = await request(app)
      .get(`/api/v1/channels/${created.body.data.account.id}`)
      .set(authHeader(acme.tokens.owner));
    expect(JSON.stringify(got.body)).not.toContain('encryptedPayload');
  });

  it('enables and disables an account', async () => {
    const created = await createFakeChannel(app, acme.tokens.owner);
    const id = created.body.data.account.id;

    const disabled = await request(app)
      .patch(`/api/v1/channels/${id}/status`)
      .set(authHeader(acme.tokens.owner))
      .send({ isEnabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.data.account.isEnabled).toBe(false);

    const enabled = await request(app)
      .patch(`/api/v1/channels/${id}/status`)
      .set(authHeader(acme.tokens.admin))
      .send({ isEnabled: true });
    expect(enabled.body.data.account.isEnabled).toBe(true);
  });

  it('disconnect soft-deletes and preserves message history', async () => {
    const created = await createFakeChannel(app, acme.tokens.owner);
    const id = created.body.data.account.id;

    // Attach a conversation + message to the account so we can prove retention.
    const customer = await prisma.customer.create({
      data: { companyId: acme.company.id, channelType: 'MANUAL', externalId: 'c1' },
    });
    const conv = await prisma.conversation.create({
      data: {
        companyId: acme.company.id,
        customerId: customer.id,
        channelType: 'MANUAL',
        channelAccountId: id,
        providerKey: 'fake',
      },
    });
    await prisma.message.create({
      data: {
        companyId: acme.company.id,
        conversationId: conv.id,
        customerId: customer.id,
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        content: 'kept',
        status: 'RECEIVED',
      },
    });

    const del = await request(app)
      .delete(`/api/v1/channels/${id}`)
      .set(authHeader(acme.tokens.owner));
    expect(del.status).toBe(200);
    expect(del.body.data.account.status).toBe('DISCONNECTED');
    expect(del.body.data.account.isEnabled).toBe(false);

    // History intact.
    expect(await prisma.message.count({ where: { conversationId: conv.id } })).toBe(1);
    expect(
      await prisma.conversation.count({ where: { id: conv.id } }),
    ).toBe(1);
  });

  it('is tenant-isolated: cross-tenant access returns 404', async () => {
    const created = await createFakeChannel(app, acme.tokens.owner);
    const id = created.body.data.account.id;

    const cross = await request(app)
      .get(`/api/v1/channels/${id}`)
      .set(authHeader(globex.tokens.owner));
    expect(cross.status).toBe(404);

    const crossPatch = await request(app)
      .patch(`/api/v1/channels/${id}`)
      .set(authHeader(globex.tokens.owner))
      .send({ displayName: 'hijack' });
    expect(crossPatch.status).toBe(404);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/channels');
    expect(res.status).toBe(401);
  });
});
