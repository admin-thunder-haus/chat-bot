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

function createService(token: string, body: Record<string, unknown>) {
  return request(app)
    .post('/api/v1/services')
    .set(authHeader(token))
    .send(body);
}

const validService = {
  name: 'Consultation',
  price: 25,
  priceType: 'FIXED',
  currency: 'JOD',
  durationMinutes: 30,
};

describe('Services CRUD & authorization', () => {
  it('OWNER can create a service (price serialized as string)', async () => {
    const res = await createService(acme.tokens.owner, validService);
    expect(res.status).toBe(201);
    expect(res.body.data.service.price).toBe('25');
    expect(typeof res.body.data.service.price).toBe('string');
  });

  it('ADMIN can create a service', async () => {
    const res = await createService(acme.tokens.admin, {
      ...validService,
      name: 'Admin Service',
    });
    expect(res.status).toBe(201);
  });

  it('AGENT cannot create a service', async () => {
    const res = await createService(acme.tokens.agent, {
      ...validService,
      name: 'Nope',
    });
    expect(res.status).toBe(403);
  });

  it('rejects a FIXED service with no price', async () => {
    const res = await createService(acme.tokens.owner, {
      name: 'No price',
      priceType: 'FIXED',
    });
    expect(res.status).toBe(400);
  });

  it('allows CONTACT_US with null price and nulls any provided price', async () => {
    const res = await createService(acme.tokens.owner, {
      name: 'Custom Work',
      priceType: 'CONTACT_US',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.service.price).toBeNull();
  });

  it('rejects a negative price', async () => {
    const res = await createService(acme.tokens.owner, {
      name: 'Negative',
      priceType: 'FIXED',
      price: -5,
    });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate service name in the same company', async () => {
    await createService(acme.tokens.owner, validService);
    const res = await createService(acme.tokens.owner, validService);
    expect(res.status).toBe(409);
  });

  it('allows the same service name in different companies', async () => {
    await createService(acme.tokens.owner, validService);
    const res = await createService(globex.tokens.owner, validService);
    expect(res.status).toBe(201);
  });

  it('OWNER can update, AGENT cannot', async () => {
    const created = await createService(acme.tokens.owner, validService);
    const id = created.body.data.service.id;

    const upd = await request(app)
      .patch(`/api/v1/services/${id}`)
      .set(authHeader(acme.tokens.owner))
      .send({ name: 'Renamed', price: 40 });
    expect(upd.status).toBe(200);
    expect(upd.body.data.service.name).toBe('Renamed');
    expect(upd.body.data.service.price).toBe('40');

    const agentUpd = await request(app)
      .patch(`/api/v1/services/${id}`)
      .set(authHeader(acme.tokens.agent))
      .send({ name: 'Hacked' });
    expect(agentUpd.status).toBe(403);
  });

  it('can toggle status via the status endpoint', async () => {
    const created = await createService(acme.tokens.owner, validService);
    const id = created.body.data.service.id;
    const res = await request(app)
      .patch(`/api/v1/services/${id}/status`)
      .set(authHeader(acme.tokens.owner))
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.service.isActive).toBe(false);
  });

  it('reorders services within a transaction', async () => {
    const a = await createService(acme.tokens.owner, { ...validService, name: 'A' });
    const b = await createService(acme.tokens.owner, { ...validService, name: 'B' });
    const res = await request(app)
      .patch('/api/v1/services/reorder')
      .set(authHeader(acme.tokens.owner))
      .send({
        items: [
          { id: b.body.data.service.id, sortOrder: 1 },
          { id: a.body.data.service.id, sortOrder: 2 },
        ],
      });
    expect(res.status).toBe(200);
    const names = res.body.data.services.map((s: { name: string }) => s.name);
    expect(names).toEqual(['B', 'A']);
  });
});

describe('Services listing: pagination & filters', () => {
  beforeEach(async () => {
    for (let i = 1; i <= 5; i++) {
      await createService(acme.tokens.owner, {
        ...validService,
        name: `Service ${i}`,
        isActive: i % 2 === 0,
        sortOrder: i,
      });
    }
  });

  it('paginates results', async () => {
    const res = await request(app)
      .get('/api/v1/services?page=1&limit=2')
      .set(authHeader(acme.tokens.owner));
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBe(2);
    expect(res.body.data.pagination.total).toBe(5);
    expect(res.body.data.pagination.totalPages).toBe(3);
  });

  it('filters by isActive', async () => {
    const res = await request(app)
      .get('/api/v1/services?isActive=true')
      .set(authHeader(acme.tokens.owner));
    expect(res.body.data.items.every((s: { isActive: boolean }) => s.isActive)).toBe(
      true,
    );
  });

  it('searches by name', async () => {
    const res = await request(app)
      .get('/api/v1/services?search=Service 3')
      .set(authHeader(acme.tokens.owner));
    expect(res.body.data.items.length).toBe(1);
    expect(res.body.data.items[0].name).toBe('Service 3');
  });
});

describe('Services multi-tenant isolation', () => {
  it('does not list another tenant’s services', async () => {
    await createService(acme.tokens.owner, validService);
    const res = await request(app)
      .get('/api/v1/services')
      .set(authHeader(globex.tokens.owner));
    expect(res.body.data.items.length).toBe(0);
  });

  it('returns 404 when fetching another tenant’s service', async () => {
    const created = await createService(acme.tokens.owner, validService);
    const id = created.body.data.service.id;
    const res = await request(app)
      .get(`/api/v1/services/${id}`)
      .set(authHeader(globex.tokens.owner));
    expect(res.status).toBe(404);
  });

  it('cannot update another tenant’s service', async () => {
    const created = await createService(acme.tokens.owner, validService);
    const id = created.body.data.service.id;
    const res = await request(app)
      .patch(`/api/v1/services/${id}`)
      .set(authHeader(globex.tokens.owner))
      .send({ name: 'Hijacked' });
    expect(res.status).toBe(404);

    // Confirm the record is untouched for the real owner.
    const check = await request(app)
      .get(`/api/v1/services/${id}`)
      .set(authHeader(acme.tokens.owner));
    expect(check.body.data.service.name).toBe(validService.name);
  });

  it('cannot delete another tenant’s service', async () => {
    const created = await createService(acme.tokens.owner, validService);
    const id = created.body.data.service.id;
    const res = await request(app)
      .delete(`/api/v1/services/${id}`)
      .set(authHeader(globex.tokens.owner));
    expect(res.status).toBe(404);

    const check = await request(app)
      .get(`/api/v1/services/${id}`)
      .set(authHeader(acme.tokens.owner));
    expect(check.status).toBe(200);
  });

  it('cannot reorder another tenant’s service ids', async () => {
    const created = await createService(acme.tokens.owner, validService);
    const id = created.body.data.service.id;
    const res = await request(app)
      .patch('/api/v1/services/reorder')
      .set(authHeader(globex.tokens.owner))
      .send({ items: [{ id, sortOrder: 1 }] });
    expect(res.status).toBe(404);
  });
});

describe('Services deletion', () => {
  it('OWNER can delete their own service', async () => {
    const created = await createService(acme.tokens.owner, validService);
    const id = created.body.data.service.id;
    const del = await request(app)
      .delete(`/api/v1/services/${id}`)
      .set(authHeader(acme.tokens.owner));
    expect(del.status).toBe(200);
    const check = await request(app)
      .get(`/api/v1/services/${id}`)
      .set(authHeader(acme.tokens.owner));
    expect(check.status).toBe(404);
  });
});
