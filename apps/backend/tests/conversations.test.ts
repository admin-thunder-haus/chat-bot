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

async function acmeConversation(overrides = {}) {
  const customer = await makeCustomer(acme.company.id);
  return makeConversation(acme.company.id, customer.id, overrides);
}

describe('Conversations', () => {
  it('OWNER/ADMIN can create a manual conversation with an initial message', async () => {
    const customer = await makeCustomer(acme.company.id);
    const res = await request(app)
      .post('/api/v1/conversations')
      .set(authHeader(acme.tokens.owner))
      .send({
        customerId: customer.id,
        subject: 'Product inquiry',
        initialMessage: 'Customer contacted us by phone.',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.conversation.subject).toBe('Product inquiry');
    expect(res.body.data.conversation.status).toBe('OPEN');
  });

  it('AGENT cannot create a conversation', async () => {
    const customer = await makeCustomer(acme.company.id);
    const res = await request(app)
      .post('/api/v1/conversations')
      .set(authHeader(acme.tokens.agent))
      .send({ customerId: customer.id });
    expect(res.status).toBe(403);
  });

  it('lists conversations with filters and search', async () => {
    const c1 = await makeCustomer(acme.company.id, { fullName: 'Alpha Person' });
    const c2 = await makeCustomer(acme.company.id, { fullName: 'Beta Person' });
    await makeConversation(acme.company.id, c1.id, { status: 'OPEN', priority: 'HIGH' });
    await makeConversation(acme.company.id, c2.id, { status: 'CLOSED' });

    const all = await request(app)
      .get('/api/v1/conversations')
      .set(authHeader(acme.tokens.owner));
    expect(all.body.data.items.length).toBe(2);

    const open = await request(app)
      .get('/api/v1/conversations?status=OPEN')
      .set(authHeader(acme.tokens.owner));
    expect(open.body.data.items.length).toBe(1);

    const search = await request(app)
      .get('/api/v1/conversations?search=Alpha')
      .set(authHeader(acme.tokens.owner));
    expect(search.body.data.items.length).toBe(1);
  });

  it('retrieves detail, marks read, and archives', async () => {
    const conv = await acmeConversation({ unreadCount: 5 });

    const detail = await request(app)
      .get(`/api/v1/conversations/${conv.id}`)
      .set(authHeader(acme.tokens.owner));
    expect(detail.status).toBe(200);
    expect(detail.body.data.conversation.id).toBe(conv.id);

    const read = await request(app)
      .patch(`/api/v1/conversations/${conv.id}/read`)
      .set(authHeader(acme.tokens.owner));
    expect(read.body.data.conversation.unreadCount).toBe(0);

    const archive = await request(app)
      .patch(`/api/v1/conversations/${conv.id}/archive`)
      .set(authHeader(acme.tokens.owner))
      .send({ isArchived: true });
    expect(archive.body.data.conversation.isArchived).toBe(true);
  });

  it('changes status and updates timestamps', async () => {
    const conv = await acmeConversation({ status: 'OPEN' });

    const resolved = await request(app)
      .patch(`/api/v1/conversations/${conv.id}/status`)
      .set(authHeader(acme.tokens.owner))
      .send({ status: 'RESOLVED' });
    expect(resolved.body.data.conversation.status).toBe('RESOLVED');
    expect(resolved.body.data.conversation.resolvedAt).not.toBeNull();

    const reopened = await request(app)
      .patch(`/api/v1/conversations/${conv.id}/status`)
      .set(authHeader(acme.tokens.owner))
      .send({ status: 'OPEN' });
    expect(reopened.body.data.conversation.resolvedAt).toBeNull();
  });

  it('changes priority (AGENT allowed)', async () => {
    const conv = await acmeConversation();
    const res = await request(app)
      .patch(`/api/v1/conversations/${conv.id}/priority`)
      .set(authHeader(acme.tokens.agent))
      .send({ priority: 'URGENT' });
    expect(res.status).toBe(200);
    expect(res.body.data.conversation.priority).toBe('URGENT');
  });

  it('assigns to a company user; AGENT can only self-assign', async () => {
    const conv = await acmeConversation();

    const ok = await request(app)
      .patch(`/api/v1/conversations/${conv.id}/assignment`)
      .set(authHeader(acme.tokens.owner))
      .send({ assignedUserId: acme.users.agent.id });
    expect(ok.status).toBe(200);
    expect(ok.body.data.conversation.assignedUser.id).toBe(acme.users.agent.id);

    // Agent assigning to someone else is forbidden.
    const forbidden = await request(app)
      .patch(`/api/v1/conversations/${conv.id}/assignment`)
      .set(authHeader(acme.tokens.agent))
      .send({ assignedUserId: acme.users.admin.id });
    expect(forbidden.status).toBe(403);

    // Agent self-assign is allowed.
    const selfAssign = await request(app)
      .patch(`/api/v1/conversations/${conv.id}/assignment`)
      .set(authHeader(acme.tokens.agent))
      .send({ assignedUserId: acme.users.agent.id });
    expect(selfAssign.status).toBe(200);
  });

  it('rejects cross-company assignment', async () => {
    const conv = await acmeConversation();
    const res = await request(app)
      .patch(`/api/v1/conversations/${conv.id}/assignment`)
      .set(authHeader(acme.tokens.owner))
      .send({ assignedUserId: globex.users.agent.id });
    expect(res.status).toBe(400);
  });

  it('is tenant-isolated (404 across tenants)', async () => {
    const conv = await acmeConversation();
    expect(
      (
        await request(app)
          .get(`/api/v1/conversations/${conv.id}`)
          .set(authHeader(globex.tokens.owner))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch(`/api/v1/conversations/${conv.id}/status`)
          .set(authHeader(globex.tokens.owner))
          .send({ status: 'CLOSED' })
      ).status,
    ).toBe(404);
  });

  it('exposes GET /users/assignable (active company users only)', async () => {
    const res = await request(app)
      .get('/api/v1/users/assignable')
      .set(authHeader(acme.tokens.owner));
    expect(res.status).toBe(200);
    expect(res.body.data.users.length).toBe(3);
    const ids = res.body.data.users.map((u: { id: string }) => u.id);
    expect(ids).not.toContain(globex.users.owner.id);
  });
});
