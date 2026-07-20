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

describe('Conversation activity (audit)', () => {
  it('records activities for key operations in chronological order', async () => {
    const customer = await makeCustomer(acme.company.id);
    // Create via API so CONVERSATION_CREATED is recorded.
    const created = await request(app)
      .post('/api/v1/conversations')
      .set(authHeader(acme.tokens.owner))
      .send({ customerId: customer.id, subject: 'Audit test' });
    const convId = created.body.data.conversation.id;

    await request(app)
      .post(`/api/v1/conversations/${convId}/messages`)
      .set(authHeader(acme.tokens.owner))
      .send({ content: 'first reply' });
    await request(app)
      .patch(`/api/v1/conversations/${convId}/status`)
      .set(authHeader(acme.tokens.owner))
      .send({ status: 'RESOLVED' });
    await request(app)
      .patch(`/api/v1/conversations/${convId}/priority`)
      .set(authHeader(acme.tokens.owner))
      .send({ priority: 'HIGH' });

    const res = await request(app)
      .get(`/api/v1/conversations/${convId}/activity`)
      .set(authHeader(acme.tokens.owner));
    expect(res.status).toBe(200);

    const activities = res.body.data.activities as {
      activityType: string;
      createdAt: string;
    }[];
    const types = activities.map((a) => a.activityType);
    expect(types).toContain('CONVERSATION_CREATED');
    expect(types).toContain('MESSAGE_SENT');
    expect(types).toContain('STATUS_CHANGED');
    expect(types).toContain('PRIORITY_CHANGED');

    // Chronological (non-decreasing timestamps).
    const times = activities.map((a) => new Date(a.createdAt).getTime());
    const sorted = [...times].sort((a, b) => a - b);
    expect(times).toEqual(sorted);
  });

  it('has no endpoint to edit or delete activities', async () => {
    const customer = await makeCustomer(acme.company.id);
    const conv = await makeConversation(acme.company.id, customer.id);
    // No PATCH/DELETE routes exist -> 404 from the router.
    expect(
      (
        await request(app)
          .delete(`/api/v1/conversations/${conv.id}/activity`)
          .set(authHeader(acme.tokens.owner))
      ).status,
    ).toBe(404);
  });

  it('is tenant-isolated', async () => {
    const customer = await makeCustomer(acme.company.id);
    const conv = await makeConversation(acme.company.id, customer.id);
    expect(
      (
        await request(app)
          .get(`/api/v1/conversations/${conv.id}/activity`)
          .set(authHeader(globex.tokens.owner))
      ).status,
    ).toBe(404);
  });
});
