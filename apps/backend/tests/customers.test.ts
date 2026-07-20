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

function createCustomer(token: string, body: Record<string, unknown>) {
  return request(app).post('/api/v1/customers').set(authHeader(token)).send(body);
}

const valid = {
  channelType: 'MANUAL',
  fullName: 'Ahmad Ali',
  email: 'Ahmad@Example.com',
  phone: '+962790000000',
};

describe('Customers', () => {
  it('OWNER and ADMIN can create; AGENT cannot', async () => {
    expect((await createCustomer(acme.tokens.owner, valid)).status).toBe(201);
    expect(
      (await createCustomer(acme.tokens.admin, { ...valid, email: 'a2@x.com' }))
        .status,
    ).toBe(201);
    expect(
      (await createCustomer(acme.tokens.agent, { ...valid, email: 'a3@x.com' }))
        .status,
    ).toBe(403);
  });

  it('normalizes email to lowercase', async () => {
    const res = await createCustomer(acme.tokens.owner, valid);
    expect(res.body.data.customer.email).toBe('ahmad@example.com');
  });

  it('AGENT can view customers', async () => {
    await createCustomer(acme.tokens.owner, valid);
    const res = await request(app)
      .get('/api/v1/customers')
      .set(authHeader(acme.tokens.agent));
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBe(1);
  });

  it('OWNER can update a customer', async () => {
    const created = await createCustomer(acme.tokens.owner, valid);
    const id = created.body.data.customer.id;
    const res = await request(app)
      .patch(`/api/v1/customers/${id}`)
      .set(authHeader(acme.tokens.owner))
      .send({ notes: 'VIP client' });
    expect(res.status).toBe(200);
    expect(res.body.data.customer.notes).toBe('VIP client');
  });

  it('rejects empty create and invalid email', async () => {
    expect((await createCustomer(acme.tokens.owner, {})).status).toBe(400);
    expect(
      (await createCustomer(acme.tokens.owner, { fullName: 'X', email: 'nope' }))
        .status,
    ).toBe(400);
  });

  it('rejects a client-provided companyId (strict schema)', async () => {
    const res = await createCustomer(acme.tokens.owner, {
      ...valid,
      companyId: globex.company.id,
    });
    expect(res.status).toBe(400);
  });

  it('supports search and pagination', async () => {
    for (let i = 0; i < 3; i++) {
      await createCustomer(acme.tokens.owner, {
        channelType: 'MANUAL',
        fullName: `Person ${i}`,
        email: `p${i}@x.com`,
      });
    }
    const search = await request(app)
      .get('/api/v1/customers?search=Person 1')
      .set(authHeader(acme.tokens.owner));
    expect(search.body.data.items.length).toBe(1);

    const paged = await request(app)
      .get('/api/v1/customers?page=1&limit=2')
      .set(authHeader(acme.tokens.owner));
    expect(paged.body.data.items.length).toBe(2);
    expect(paged.body.data.pagination.total).toBe(3);
  });

  it('is tenant-isolated (404 across tenants, empty lists)', async () => {
    const created = await createCustomer(acme.tokens.owner, valid);
    const id = created.body.data.customer.id;

    expect(
      (
        await request(app)
          .get(`/api/v1/customers/${id}`)
          .set(authHeader(globex.tokens.owner))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch(`/api/v1/customers/${id}`)
          .set(authHeader(globex.tokens.owner))
          .send({ notes: 'x' })
      ).status,
    ).toBe(404);

    const list = await request(app)
      .get('/api/v1/customers')
      .set(authHeader(globex.tokens.owner));
    expect(list.body.data.items.length).toBe(0);
  });
});
