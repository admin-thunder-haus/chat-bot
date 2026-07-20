import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';

const app = createApp();
let acme: Tenant;
let globex: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
});

function mockInbound(token: string, body: Record<string, unknown>) {
  return request(app)
    .post('/api/v1/dev/mock-inbound-message')
    .set(authHeader(token))
    .send(body);
}

const payload = (msgId: string, extCustomer = 'demo-customer-001') => ({
  channelType: 'MANUAL',
  externalCustomerId: extCustomer,
  customer: { fullName: 'Ahmad Ali', phone: '+962790000000', email: 'ahmad@example.com' },
  message: { externalMessageId: msgId, content: 'Hello, I want to know your prices.' },
});

describe('Mock inbound message', () => {
  it('creates customer, conversation, and inbound message with unread=1', async () => {
    const res = await mockInbound(acme.tokens.owner, payload('m1'));
    expect(res.status).toBe(201);
    expect(res.body.data.idempotent).toBe(false);
    expect(res.body.data.customer.fullName).toBe('Ahmad Ali');
    expect(res.body.data.message.direction).toBe('INBOUND');
    expect(res.body.data.message.senderType).toBe('CUSTOMER');
    expect(res.body.data.message.status).toBe('RECEIVED');
    expect(res.body.data.conversation.unreadCount).toBe(1);
  });

  it('reuses the existing customer and conversation on a second message', async () => {
    const first = await mockInbound(acme.tokens.owner, payload('m1'));
    const second = await mockInbound(acme.tokens.owner, payload('m2'));
    expect(second.body.data.customer.id).toBe(first.body.data.customer.id);
    expect(second.body.data.conversation.id).toBe(first.body.data.conversation.id);
    expect(second.body.data.conversation.unreadCount).toBe(2);
  });

  it('is idempotent for a duplicate externalMessageId', async () => {
    const first = await mockInbound(acme.tokens.owner, payload('dup'));
    const dup = await mockInbound(acme.tokens.owner, payload('dup'));
    expect(dup.status).toBe(200);
    expect(dup.body.data.idempotent).toBe(true);
    expect(dup.body.data.message.id).toBe(first.body.data.message.id);
    // Unread not double-incremented.
    expect(dup.body.data.conversation.unreadCount).toBe(1);
  });

  it('reopens a resolved conversation on a new inbound message', async () => {
    const first = await mockInbound(acme.tokens.owner, payload('m1'));
    const convId = first.body.data.conversation.id;

    await request(app)
      .patch(`/api/v1/conversations/${convId}/status`)
      .set(authHeader(acme.tokens.owner))
      .send({ status: 'RESOLVED' });

    const reopened = await mockInbound(acme.tokens.owner, payload('m2'));
    expect(reopened.body.data.conversation.status).toBe('OPEN');
  });

  it('is tenant-isolated (same external ids live in separate companies)', async () => {
    await mockInbound(acme.tokens.owner, payload('m1'));
    const other = await mockInbound(globex.tokens.owner, payload('m1'));
    expect(other.status).toBe(201);
    expect(other.body.data.idempotent).toBe(false);

    const acmeList = await request(app)
      .get('/api/v1/conversations')
      .set(authHeader(acme.tokens.owner));
    expect(acmeList.body.data.items.length).toBe(1);
  });

  it('rejects a client-provided companyId (strict schema)', async () => {
    const res = await mockInbound(acme.tokens.owner, {
      ...payload('m1'),
      companyId: globex.company.id,
    });
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app)
      .post('/api/v1/dev/mock-inbound-message')
      .send(payload('m1'));
    expect(res.status).toBe(401);
  });
});
