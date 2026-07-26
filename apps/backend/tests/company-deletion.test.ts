import request from 'supertest';
import { createApp } from '../src/app';
import { authHeader, makeConversation, makeCustomer, setupTenant, type Tenant } from './helpers';
import { createFakeChannel } from './channel-helpers';
import { installFakeS3, uninstallFakeS3 } from './storage-helpers';
import { setS3TransportForTesting } from '../src/modules/storage/s3-storage.provider';
import { prisma } from './setup';

/**
 * "Delete my company": OWNER-only, typed-name confirmed, and COMPLETE.
 *
 * The important test here is `leaves nothing behind in ANY table`. It does not
 * trust the schema's cascades or the code's comments — it enumerates every
 * Prisma model that has a companyId column via the runtime DMMF and asserts a
 * zero count for the deleted tenant in each one. That means a model added in
 * six months without `onDelete: Cascade` FAILS THIS TEST rather than silently
 * orphaning a deleted customer's data.
 */

const app = createApp();
let acme: Tenant;
let globex: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
});

function deleteCompany(token: string, confirmName: string) {
  return request(app)
    .delete('/api/v1/company')
    .set(authHeader(token))
    .send({ confirmName });
}

/**
 * Every model with a `companyId` field, discovered at runtime rather than
 * hardcoded — a hardcoded list is exactly what goes stale.
 * Returns [prismaDelegateName, modelName] pairs.
 */
function tenantScopedModels(): [string, string][] {
  const runtime = prisma as unknown as {
    _runtimeDataModel: {
      models: Record<string, { fields: { name: string }[] }>;
    };
  };
  const models = runtime._runtimeDataModel.models;
  const out: [string, string][] = [];
  for (const [name, model] of Object.entries(models)) {
    if (!model.fields.some((f) => f.name === 'companyId')) continue;
    // Prisma's delegate is the model name with a lowercase first letter.
    out.push([name.charAt(0).toLowerCase() + name.slice(1), name]);
  }
  return out;
}

/** Fill a tenant with at least one row in as many tables as practical. */
async function fillTenant(tenant: Tenant): Promise<void> {
  const companyId = tenant.company.id;

  await createFakeChannel(app, tenant.tokens.owner);

  const customer = await makeCustomer(companyId);
  const conversation = await makeConversation(companyId, customer.id);
  const message = await prisma.message.create({
    data: {
      companyId,
      conversationId: conversation.id,
      customerId: customer.id,
      direction: 'INBOUND',
      senderType: 'CUSTOMER',
      content: 'Hello there',
      status: 'RECEIVED',
      sentAt: new Date(),
    },
  });

  await prisma.internalNote.create({
    data: {
      companyId,
      conversationId: conversation.id,
      authorUserId: tenant.users.owner.id,
      content: 'Internal note',
    },
  });
  const tag = await prisma.conversationTag.create({
    data: { companyId, name: 'vip', color: '#ff0000' },
  });
  await prisma.conversationTagAssignment.create({
    data: { companyId, conversationId: conversation.id, tagId: tag.id },
  });
  await prisma.conversationActivity.create({
    data: {
      companyId,
      conversationId: conversation.id,
      activityType: 'MESSAGE_RECEIVED',
      actorUserId: null,
    },
  });

  await prisma.businessService.create({
    data: { companyId, name: 'Consulting', priceType: 'CONTACT_US' },
  });
  await prisma.product.create({ data: { companyId, name: 'Widget' } });
  await prisma.businessHour.create({
    data: { companyId, dayOfWeek: 'MONDAY', openTime: '09:00', closeTime: '17:00' },
  });
  await prisma.frequentlyAskedQuestion.create({
    data: { companyId, question: 'Hours?', answer: '9-5' },
  });
  await prisma.knowledgeBaseEntry.create({
    data: { companyId, title: 'Policy', content: 'Some policy text' },
  });
  await prisma.companyAISettings.create({ data: { companyId } });
  await prisma.storedImage.create({
    data: {
      companyId,
      fileName: 'x.png',
      mimeType: 'image/png',
      sizeBytes: 3,
      data: new Uint8Array([1, 2, 3]),
    },
  });
  const doc = await prisma.knowledgeDocument.create({
    data: {
      companyId,
      fileName: 'terms.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4,
      data: new Uint8Array([1, 2, 3, 4]),
    },
  });
  await prisma.knowledgeDocumentChunk.create({
    data: { companyId, documentId: doc.id, chunkIndex: 0, content: 'chunk' },
  });

  await prisma.notification.create({
    data: {
      companyId,
      type: 'SYSTEM_ALERT',
      title: 'Something happened',
      body: 'Body text',
    },
  });
  await prisma.apiKey.create({
    data: { companyId, name: 'k', keyHash: `hash-${companyId}`, keyPrefix: 'ak_live_x' },
  });
  const webhook = await prisma.outboundWebhook.create({
    data: {
      companyId,
      url: 'https://example.test/hook',
      // Not a real secret: the encryption seam is covered by public-api tests.
      encryptedSecret: 'not-a-real-encrypted-secret',
      events: ['conversation.created'],
    },
  });
  await prisma.outboundWebhookDelivery.create({
    data: {
      companyId,
      webhookId: webhook.id,
      eventType: 'conversation.created',
      status: 'delivered',
    },
  });

  await prisma.appointment.create({
    data: { companyId, customerId: customer.id, scheduledAt: new Date() },
  });
  const order = await prisma.order.create({
    data: { companyId, customerId: customer.id, totalAmount: '10.00' },
  });
  await prisma.orderItem.create({
    data: {
      companyId,
      orderId: order.id,
      name: 'Widget',
      quantity: 1,
      unitPrice: '10.00',
    },
  });
  await prisma.supportTicket.create({
    data: { companyId, customerId: customer.id, subject: 'Broken', description: 'It broke' },
  });
  await prisma.aIActionExecution.create({
    data: { companyId, actionKey: 'create_order', status: 'SUCCESS', input: {} },
  });

  await prisma.aIResponseGeneration.create({
    data: {
      companyId,
      conversationId: conversation.id,
      sourceMessageId: message.id,
      generationType: 'DRAFT',
      status: 'COMPLETED',
      provider: 'test',
      model: 'test-model',
      promptVersion: 'v1',
    },
  });
  await prisma.aIUsageDaily.create({
    data: { companyId, date: new Date('2026-01-01T00:00:00.000Z') },
  });

  await prisma.job.create({
    data: { companyId, type: 'ai.auto-reply', payload: { messageId: message.id } },
  });
  await prisma.loginAuditEvent.create({
    data: {
      companyId,
      userId: tenant.users.owner.id,
      email: tenant.users.owner.email,
      outcome: 'SUCCESS',
    },
  });
  await prisma.refreshToken.create({
    data: {
      userId: tenant.users.owner.id,
      tokenHash: `refresh-${companyId}`,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  await prisma.passwordResetToken.create({
    data: {
      userId: tenant.users.owner.id,
      tokenHash: `reset-${companyId}`,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  await prisma.emailVerificationCode.create({
    data: {
      userId: tenant.users.owner.id,
      codeHash: `code-${companyId}`,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
}

/** Row count for `companyId` in one Prisma delegate. */
function countFor(delegate: string, companyId: string): Promise<number> {
  const client = prisma as unknown as Record<
    string,
    { count(args: unknown): Promise<number> }
  >;
  return client[delegate].count({ where: { companyId } });
}

describe('authorization and confirmation', () => {
  it('rejects an ADMIN and an AGENT', async () => {
    for (const token of [acme.tokens.admin, acme.tokens.agent]) {
      const res = await deleteCompany(token, acme.company.name);
      expect(res.status).toBe(403);
    }
    expect(
      await prisma.company.findUnique({ where: { id: acme.company.id } }),
    ).not.toBeNull();
  });

  it('requires the confirmation field at all', async () => {
    const res = await request(app)
      .delete('/api/v1/company')
      .set(authHeader(acme.tokens.owner))
      .send({});
    expect(res.status).toBe(400);
    expect(
      await prisma.company.findUnique({ where: { id: acme.company.id } }),
    ).not.toBeNull();
  });

  it('rejects a name that does not match, and deletes nothing', async () => {
    const res = await deleteCompany(acme.tokens.owner, 'Some Other Company');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('COMPANY_NAME_MISMATCH');
    expect(
      await prisma.company.findUnique({ where: { id: acme.company.id } }),
    ).not.toBeNull();
  });

  it('accepts the name with different casing and padding', async () => {
    const res = await deleteCompany(
      acme.tokens.owner,
      `  ${acme.company.name.toUpperCase()}  `,
    );
    expect(res.status).toBe(200);
    expect(
      await prisma.company.findUnique({ where: { id: acme.company.id } }),
    ).toBeNull();
  });

  it('requires authentication', async () => {
    const res = await request(app)
      .delete('/api/v1/company')
      .send({ confirmName: acme.company.name });
    expect(res.status).toBe(401);
  });
});

describe('completeness', () => {
  it('leaves nothing behind in ANY table that has a companyId', async () => {
    await fillTenant(acme);
    await fillTenant(globex);

    const models = tenantScopedModels();
    // Sanity: if this discovery breaks, the whole test silently passes.
    expect(models.length).toBeGreaterThan(30);

    // Every table genuinely has acme data (or is legitimately empty) before we
    // delete — otherwise "0 afterwards" would prove nothing.
    const before = new Map<string, number>();
    for (const [delegate] of models) {
      // eslint-disable-next-line no-await-in-loop
      before.set(delegate, await countFor(delegate, acme.company.id));
    }
    const populated = [...before.entries()].filter(([, n]) => n > 0);
    expect(populated.length).toBeGreaterThan(25);

    const res = await deleteCompany(acme.tokens.owner, acme.company.name);
    expect(res.status).toBe(200);

    const leftovers: string[] = [];
    for (const [delegate, model] of models) {
      // eslint-disable-next-line no-await-in-loop
      const remaining = await countFor(delegate, acme.company.id);
      if (remaining > 0) leftovers.push(`${model} (${remaining} rows)`);
    }
    expect(leftovers).toEqual([]);

    // The company row itself, and its users, are gone.
    expect(
      await prisma.company.findUnique({ where: { id: acme.company.id } }),
    ).toBeNull();
    expect(
      await prisma.user.count({ where: { companyId: acme.company.id } }),
    ).toBe(0);
  });

  it('takes per-user rows with it (tokens, codes, reset links)', async () => {
    await fillTenant(acme);
    const ownerId = acme.users.owner.id;

    await deleteCompany(acme.tokens.owner, acme.company.name);

    expect(await prisma.refreshToken.count({ where: { userId: ownerId } })).toBe(0);
    expect(
      await prisma.emailVerificationCode.count({ where: { userId: ownerId } }),
    ).toBe(0);
    expect(
      await prisma.passwordResetToken.count({ where: { userId: ownerId } }),
    ).toBe(0);
  });

  it('touches no other tenant', async () => {
    await fillTenant(acme);
    await fillTenant(globex);

    const models = tenantScopedModels();
    const before = new Map<string, number>();
    for (const [delegate] of models) {
      // eslint-disable-next-line no-await-in-loop
      before.set(delegate, await countFor(delegate, globex.company.id));
    }

    await deleteCompany(acme.tokens.owner, acme.company.name);

    const changed: string[] = [];
    for (const [delegate, model] of models) {
      // eslint-disable-next-line no-await-in-loop
      const after = await countFor(delegate, globex.company.id);
      if (after !== before.get(delegate)) {
        changed.push(`${model}: ${before.get(delegate)} -> ${after}`);
      }
    }
    expect(changed).toEqual([]);
    expect(
      await prisma.company.findUnique({ where: { id: globex.company.id } }),
    ).not.toBeNull();
  });

  it('removes the tenant’s objects from the bucket in S3 mode', async () => {
    // With a bucket configured, the ROWS are the only record of which objects
    // belong to this tenant. Cascading them away first would orphan the files of
    // a customer who explicitly asked to be erased.
    const bucket = installFakeS3();
    try {
      const image = await request(app)
        .post('/api/v1/images')
        .set(authHeader(acme.tokens.owner))
        .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
          filename: 'logo.png',
          contentType: 'image/png',
        });
      expect(image.status).toBe(201);

      const doc = await request(app)
        .post('/api/v1/knowledge-documents')
        .set(authHeader(acme.tokens.owner))
        .attach('files', Buffer.from('%PDF-1.4 test'), {
          filename: 'terms.pdf',
          contentType: 'application/pdf',
        });
      expect(doc.status).toBe(201);

      // Both uploads really went to the bucket.
      const keys = [...bucket.objects.keys()];
      expect(keys.filter((k) => k.includes(acme.company.id))).toHaveLength(2);

      const res = await deleteCompany(acme.tokens.owner, acme.company.name);
      expect(res.status).toBe(200);

      // Nothing of this tenant is left in the bucket.
      expect(
        [...bucket.objects.keys()].filter((k) => k.includes(acme.company.id)),
      ).toEqual([]);
      expect(bucket.requests.filter((r) => r.method === 'DELETE')).toHaveLength(2);
    } finally {
      uninstallFakeS3();
    }
  });

  it('still deletes the account when the bucket refuses a delete', async () => {
    const bucket = installFakeS3();
    try {
      await request(app)
        .post('/api/v1/images')
        .set(authHeader(acme.tokens.owner))
        .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
          filename: 'logo.png',
          contentType: 'image/png',
        });

      // A stuck object must not hold the customer's account hostage.
      setS3TransportForTesting(() =>
        Promise.reject(new Error('bucket is having a bad day')),
      );

      const res = await deleteCompany(acme.tokens.owner, acme.company.name);
      expect(res.status).toBe(200);
      expect(
        await prisma.company.findUnique({ where: { id: acme.company.id } }),
      ).toBeNull();
      // The object is knowingly left behind (and logged), not silently forgotten.
      expect(bucket.objects.size).toBe(1);
    } finally {
      uninstallFakeS3();
    }
  });

  it('the deleted owner can no longer use their access token', async () => {
    await deleteCompany(acme.tokens.owner, acme.company.name);

    const res = await request(app)
      .get('/api/v1/company/profile')
      .set(authHeader(acme.tokens.owner));
    // The middleware re-validates the user against the database, so a token for
    // a deleted tenant is dead immediately rather than valid until it expires.
    expect(res.status).toBe(401);
  });
});
