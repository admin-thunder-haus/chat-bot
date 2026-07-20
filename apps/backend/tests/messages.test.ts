import request from 'supertest';
import { createApp } from '../src/app';
import {
  setupTenant,
  authHeader,
  makeCustomer,
  makeConversation,
  type Tenant,
} from './helpers';

const app = createApp();
let acme: Tenant;
let globex: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
});

async function acmeConversation() {
  const customer = await makeCustomer(acme.company.id);
  return makeConversation(acme.company.id, customer.id);
}

describe('Messages', () => {
  it('agent can send an outbound message and it updates conversation markers', async () => {
    const conv = await acmeConversation();
    const res = await request(app)
      .post(`/api/v1/conversations/${conv.id}/messages`)
      .set(authHeader(acme.tokens.agent))
      .send({ content: 'Hello, how can we help you?' });
    expect(res.status).toBe(201);
    expect(res.body.data.message.direction).toBe('OUTBOUND');
    expect(res.body.data.message.senderType).toBe('AGENT');
    expect(res.body.data.message.senderUserId).toBe(acme.users.agent.id);

    const detail = await request(app)
      .get(`/api/v1/conversations/${conv.id}`)
      .set(authHeader(acme.tokens.owner));
    expect(detail.body.data.conversation.lastOutboundMessageAt).not.toBeNull();
    expect(detail.body.data.conversation.lastMessageAt).not.toBeNull();
  });

  it('rejects empty and whitespace-only messages', async () => {
    const conv = await acmeConversation();
    expect(
      (
        await request(app)
          .post(`/api/v1/conversations/${conv.id}/messages`)
          .set(authHeader(acme.tokens.owner))
          .send({ content: '   ' })
      ).status,
    ).toBe(400);
  });

  it('rejects excessively long messages', async () => {
    const conv = await acmeConversation();
    const res = await request(app)
      .post(`/api/v1/conversations/${conv.id}/messages`)
      .set(authHeader(acme.tokens.owner))
      .send({ content: 'a'.repeat(4001) });
    expect(res.status).toBe(400);
  });

  it('creates a MESSAGE_SENT activity', async () => {
    const conv = await acmeConversation();
    await request(app)
      .post(`/api/v1/conversations/${conv.id}/messages`)
      .set(authHeader(acme.tokens.owner))
      .send({ content: 'Hi there' });
    const activity = await request(app)
      .get(`/api/v1/conversations/${conv.id}/activity`)
      .set(authHeader(acme.tokens.owner));
    const types = activity.body.data.activities.map(
      (a: { activityType: string }) => a.activityType,
    );
    expect(types).toContain('MESSAGE_SENT');
  });

  it('returns the latest page first with cursor pagination (newest at bottom)', async () => {
    const conv = await acmeConversation();
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post(`/api/v1/conversations/${conv.id}/messages`)
        .set(authHeader(acme.tokens.owner))
        .send({ content: `Message ${i}` });
    }
    // Default page returns the LATEST `limit` messages, ascending.
    const res = await request(app)
      .get(`/api/v1/conversations/${conv.id}/messages?limit=2`)
      .set(authHeader(acme.tokens.owner));
    expect(res.body.data.items.length).toBe(2);
    expect(res.body.data.hasMore).toBe(true);
    expect(res.body.data.nextCursor).toEqual(expect.any(String));
    // Newest message is last in the returned window.
    expect(res.body.data.items[1].content).toBe('Message 2');

    // Load the older page via the cursor — no gaps, no duplicates.
    const older = await request(app)
      .get(
        `/api/v1/conversations/${conv.id}/messages?limit=2&before=${res.body.data.nextCursor}`,
      )
      .set(authHeader(acme.tokens.owner));
    expect(older.body.data.items[0].content).toBe('Message 0');
    expect(older.body.data.hasMore).toBe(false);
  });

  it('cannot send to or read another tenant’s conversation', async () => {
    const conv = await acmeConversation();
    expect(
      (
        await request(app)
          .post(`/api/v1/conversations/${conv.id}/messages`)
          .set(authHeader(globex.tokens.owner))
          .send({ content: 'intrusion' })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`/api/v1/conversations/${conv.id}/messages`)
          .set(authHeader(globex.tokens.owner))
      ).status,
    ).toBe(404);
  });
});
