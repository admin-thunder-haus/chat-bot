import request from 'supertest';
import { createApp } from '../src/app';
import {
  setupTenant,
  authHeader,
  makeCustomer,
  makeConversation,
  type Tenant,
} from './helpers';
import { prisma } from './setup';

const app = createApp();
let acme: Tenant;
let globex: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
});

async function convWithMessages(count: number) {
  const customer = await makeCustomer(acme.company.id);
  const conv = await makeConversation(acme.company.id, customer.id);
  for (let i = 0; i < count; i++) {
    await request(app)
      .post(`/api/v1/conversations/${conv.id}/messages`)
      .set(authHeader(acme.tokens.owner))
      .send({ content: `Message ${i}` });
  }
  return conv;
}

function list(convId: string, token: string, qs = '') {
  return request(app)
    .get(`/api/v1/conversations/${convId}/messages${qs}`)
    .set(authHeader(token));
}

describe('Message pagination (cursor)', () => {
  it('returns the latest page by default (newest at the bottom)', async () => {
    const conv = await convWithMessages(5);
    const res = await list(conv.id, acme.tokens.owner, '?limit=3');
    expect(res.body.data.items.length).toBe(3);
    expect(res.body.data.hasMore).toBe(true);
    const contents = res.body.data.items.map((m: { content: string }) => m.content);
    expect(contents).toEqual(['Message 2', 'Message 3', 'Message 4']);
  });

  it('loads older pages via the cursor with no gaps and no duplicates', async () => {
    const conv = await convWithMessages(5);
    const seen = new Set<string>();
    let cursor: string | undefined;
    let hasMore = true;
    const collected: string[] = [];
    let guard = 0;
    while (hasMore && guard < 10) {
      guard += 1;
      const res = await list(
        conv.id,
        acme.tokens.owner,
        `?limit=2${cursor ? `&before=${cursor}` : ''}`,
      );
      for (const m of res.body.data.items) {
        expect(seen.has(m.id)).toBe(false); // no duplicates across pages
        seen.add(m.id);
      }
      collected.unshift(
        ...res.body.data.items.map((m: { content: string }) => m.content),
      );
      hasMore = res.body.data.hasMore;
      cursor = res.body.data.nextCursor ?? undefined;
    }
    expect(collected).toEqual([
      'Message 0',
      'Message 1',
      'Message 2',
      'Message 3',
      'Message 4',
    ]);
  });

  it('keeps equal timestamps stably ordered by id tie-break', async () => {
    const customer = await makeCustomer(acme.company.id);
    const conv = await makeConversation(acme.company.id, customer.id);
    const sharedTime = new Date('2026-01-01T10:00:00.000Z');
    // Three messages with identical createdAt.
    for (let i = 0; i < 3; i++) {
      await prisma.message.create({
        data: {
          companyId: acme.company.id,
          conversationId: conv.id,
          customerId: customer.id,
          direction: 'INBOUND',
          senderType: 'CUSTOMER',
          content: `Equal ${i}`,
          status: 'RECEIVED',
          createdAt: sharedTime,
          sentAt: sharedTime,
        },
      });
    }
    const page1 = await list(conv.id, acme.tokens.owner, '?limit=2');
    expect(page1.body.data.items.length).toBe(2);
    expect(page1.body.data.hasMore).toBe(true);
    const older = await list(
      conv.id,
      acme.tokens.owner,
      `?limit=2&before=${page1.body.data.nextCursor}`,
    );
    // Union of both pages is exactly the 3 messages, no duplicates.
    const ids = [
      ...older.body.data.items.map((m: { id: string }) => m.id),
      ...page1.body.data.items.map((m: { id: string }) => m.id),
    ];
    expect(new Set(ids).size).toBe(3);
  });

  it('sending a new message does not remove older messages', async () => {
    const conv = await convWithMessages(3);
    await request(app)
      .post(`/api/v1/conversations/${conv.id}/messages`)
      .set(authHeader(acme.tokens.owner))
      .send({ content: 'Newest' });
    const res = await list(conv.id, acme.tokens.owner, '?limit=50');
    const contents = res.body.data.items.map((m: { content: string }) => m.content);
    expect(contents).toEqual(['Message 0', 'Message 1', 'Message 2', 'Newest']);
    expect(res.body.data.hasMore).toBe(false);
  });

  it('does not expose another tenant’s messages', async () => {
    const conv = await convWithMessages(2);
    const res = await list(conv.id, globex.tokens.owner);
    expect(res.status).toBe(404);
  });
});
