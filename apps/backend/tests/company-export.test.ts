import request from 'supertest';
import { createApp } from '../src/app';
import {
  authHeader,
  makeConversation,
  makeCustomer,
  setupTenant,
  type Tenant,
} from './helpers';
import { prisma } from './setup';

/**
 * GDPR data portability. Two things matter more than the field list:
 *   1. it contains NO secret (a leaked export must not be a credential dump), and
 *   2. it contains NO other tenant's data.
 */

const app = createApp();
let acme: Tenant;
let globex: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
});

function exportData(token: string) {
  return request(app).get('/api/v1/company/export').set(authHeader(token));
}

async function seed(tenant: Tenant, marker: string): Promise<void> {
  const companyId = tenant.company.id;
  const customer = await makeCustomer(companyId, { fullName: `${marker} Customer` });
  const conversation = await makeConversation(companyId, customer.id);
  await prisma.message.create({
    data: {
      companyId,
      conversationId: conversation.id,
      customerId: customer.id,
      direction: 'INBOUND',
      senderType: 'CUSTOMER',
      content: `${marker} said something`,
      status: 'RECEIVED',
      sentAt: new Date(),
    },
  });
  await prisma.product.create({ data: { companyId, name: `${marker} Widget` } });
  await prisma.knowledgeDocument.create({
    data: {
      companyId,
      fileName: `${marker}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 4,
      data: new Uint8Array([1, 2, 3, 4]),
    },
  });
  await prisma.channelAccount.create({
    data: {
      companyId,
      providerKey: 'fake',
      channelType: 'WEBCHAT',
      displayName: `${marker} channel`,
      externalAccountId: `${marker}-acct`,
    },
  });
}

describe('GET /company/export', () => {
  it('is OWNER-only', async () => {
    for (const token of [acme.tokens.admin, acme.tokens.agent]) {
      expect((await exportData(token)).status).toBe(403);
    }
    expect((await exportData(acme.tokens.owner)).status).toBe(200);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/company/export')).status).toBe(401);
  });

  it('downloads as a named JSON file', async () => {
    const res = await exportData(acme.tokens.owner);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain(acme.company.slug);
  });

  it('includes the tenant data an owner would expect', async () => {
    await seed(acme, 'acme');
    const res = await exportData(acme.tokens.owner);
    const body = JSON.parse(res.text);

    expect(body.meta.companyId).toBe(acme.company.id);
    expect(body.meta.formatVersion).toBe(1);
    expect(body.company.id).toBe(acme.company.id);
    expect(body.users).toHaveLength(3);
    expect(body.customers).toHaveLength(1);
    expect(body.conversations).toHaveLength(1);
    expect(body.messages[0].content).toBe('acme said something');
    expect(body.products[0].name).toBe('acme Widget');
    expect(body.knowledgeDocuments[0].fileName).toBe('acme.pdf');
    expect(body.channelAccounts[0].displayName).toBe('acme channel');
    // Counts let the owner sanity-check the file without reading it all.
    expect(body.meta.counts.messages).toBe(1);
  });

  it('carries NO secret material at all', async () => {
    await seed(acme, 'acme');
    // A real encrypted credential and a real API key row, so their absence is
    // proven rather than assumed from an empty table.
    const account = await prisma.channelAccount.findFirst({
      where: { companyId: acme.company.id },
    });
    await prisma.channelCredential.create({
      data: {
        companyId: acme.company.id,
        channelAccountId: account!.id,
        encryptedPayload: 'SUPER-SECRET-CIPHERTEXT',
        encryptionVersion: 'v1',
      },
    });
    await prisma.apiKey.create({
      data: {
        companyId: acme.company.id,
        name: 'k',
        keyPrefix: 'ak_live_x',
        keyHash: 'SECRET-KEY-HASH',
      },
    });
    await prisma.outboundWebhook.create({
      data: {
        companyId: acme.company.id,
        url: 'https://example.test/hook',
        encryptedSecret: 'SECRET-WEBHOOK-SIGNING-KEY',
        events: ['conversation.created'],
      },
    });

    const raw = (await exportData(acme.tokens.owner)).text;

    for (const secret of [
      'SUPER-SECRET-CIPHERTEXT',
      'SECRET-KEY-HASH',
      'SECRET-WEBHOOK-SIGNING-KEY',
      'passwordHash',
      'encryptedPayload',
      'encryptedSecret',
      'tokenHash',
    ]) {
      expect(raw).not.toContain(secret);
    }
    // The users ARE present — it is only their hashes that are gone.
    const body = JSON.parse(raw);
    expect(body.users[0].email).toBeTruthy();
    expect(body.users[0]).not.toHaveProperty('passwordHash');
  });

  it('lists documents as metadata, never as bytes', async () => {
    await seed(acme, 'acme');
    const body = JSON.parse((await exportData(acme.tokens.owner)).text);
    expect(body.knowledgeDocuments[0]).not.toHaveProperty('data');
    expect(body.knowledgeDocuments[0].sizeBytes).toBe(4);
    expect(body.meta.excluded.join(' ')).toMatch(/file bytes/i);
  });

  it('contains no other tenant data', async () => {
    await seed(acme, 'acme');
    await seed(globex, 'globex');

    const raw = (await exportData(acme.tokens.owner)).text;
    expect(raw).toContain('acme said something');
    expect(raw).not.toContain('globex');
    expect(raw).not.toContain(globex.company.id);
  });
});
