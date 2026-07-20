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

function createFaq(token: string, body: Record<string, unknown>) {
  return request(app).post('/api/v1/faqs').set(authHeader(token)).send(body);
}

const validFaq = {
  question: 'What are your hours?',
  answer: 'Nine to five, Sunday to Thursday.',
  category: 'General',
};

describe('FAQs CRUD & authorization', () => {
  it('OWNER and ADMIN can create; AGENT cannot', async () => {
    expect((await createFaq(acme.tokens.owner, validFaq)).status).toBe(201);
    expect(
      (await createFaq(acme.tokens.admin, { ...validFaq, question: 'Q2?' }))
        .status,
    ).toBe(201);
    expect(
      (await createFaq(acme.tokens.agent, { ...validFaq, question: 'Q3?' }))
        .status,
    ).toBe(403);
  });

  it('AGENT can read FAQs', async () => {
    await createFaq(acme.tokens.owner, validFaq);
    const res = await request(app)
      .get('/api/v1/faqs')
      .set(authHeader(acme.tokens.agent));
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBe(1);
  });

  it('validates required fields', async () => {
    const res = await createFaq(acme.tokens.owner, { question: '' });
    expect(res.status).toBe(400);
  });

  it('updates, toggles status, and deletes', async () => {
    const created = await createFaq(acme.tokens.owner, validFaq);
    const id = created.body.data.faq.id;

    const upd = await request(app)
      .patch(`/api/v1/faqs/${id}`)
      .set(authHeader(acme.tokens.admin))
      .send({ answer: 'Updated answer.' });
    expect(upd.body.data.faq.answer).toBe('Updated answer.');

    const status = await request(app)
      .patch(`/api/v1/faqs/${id}/status`)
      .set(authHeader(acme.tokens.owner))
      .send({ isActive: false });
    expect(status.body.data.faq.isActive).toBe(false);

    const del = await request(app)
      .delete(`/api/v1/faqs/${id}`)
      .set(authHeader(acme.tokens.owner));
    expect(del.status).toBe(200);
  });

  it('AGENT cannot update or delete', async () => {
    const created = await createFaq(acme.tokens.owner, validFaq);
    const id = created.body.data.faq.id;
    expect(
      (
        await request(app)
          .patch(`/api/v1/faqs/${id}`)
          .set(authHeader(acme.tokens.agent))
          .send({ answer: 'x' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .delete(`/api/v1/faqs/${id}`)
          .set(authHeader(acme.tokens.agent))
      ).status,
    ).toBe(403);
  });

  it('filters by category and paginates', async () => {
    await createFaq(acme.tokens.owner, { ...validFaq, question: 'A?', category: 'Billing' });
    await createFaq(acme.tokens.owner, { ...validFaq, question: 'B?', category: 'General' });

    const byCat = await request(app)
      .get('/api/v1/faqs?category=Billing')
      .set(authHeader(acme.tokens.owner));
    expect(byCat.body.data.items.length).toBe(1);

    const paged = await request(app)
      .get('/api/v1/faqs?page=1&limit=1')
      .set(authHeader(acme.tokens.owner));
    expect(paged.body.data.items.length).toBe(1);
    expect(paged.body.data.pagination.total).toBe(2);
  });

  it('reorders FAQs', async () => {
    const a = await createFaq(acme.tokens.owner, { ...validFaq, question: 'A?' });
    const b = await createFaq(acme.tokens.owner, { ...validFaq, question: 'B?' });
    const res = await request(app)
      .patch('/api/v1/faqs/reorder')
      .set(authHeader(acme.tokens.owner))
      .send({
        items: [
          { id: b.body.data.faq.id, sortOrder: 1 },
          { id: a.body.data.faq.id, sortOrder: 2 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.faqs[0].question).toBe('B?');
  });

  it('is isolated between tenants (404 cross-tenant, empty lists)', async () => {
    const created = await createFaq(acme.tokens.owner, validFaq);
    const id = created.body.data.faq.id;

    expect(
      (
        await request(app)
          .get(`/api/v1/faqs/${id}`)
          .set(authHeader(globex.tokens.owner))
      ).status,
    ).toBe(404);

    const list = await request(app)
      .get('/api/v1/faqs')
      .set(authHeader(globex.tokens.owner));
    expect(list.body.data.items.length).toBe(0);
  });
});
