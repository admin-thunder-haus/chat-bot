import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';

const app = createApp();
let tenant: Tenant;

beforeEach(async () => {
  tenant = await setupTenant('acme');
});

describe('GET /api/v1/company/profile', () => {
  it('returns the profile for any authenticated role', async () => {
    for (const token of [
      tenant.tokens.owner,
      tenant.tokens.admin,
      tenant.tokens.agent,
    ]) {
      const res = await request(app)
        .get('/api/v1/company/profile')
        .set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.data.company.id).toBe(tenant.company.id);
    }
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/v1/company/profile');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/v1/company/profile', () => {
  it('lets OWNER update the profile', async () => {
    const res = await request(app)
      .patch('/api/v1/company/profile')
      .set(authHeader(tenant.tokens.owner))
      .send({ displayName: 'Acme Rockets', city: 'Amman' });

    expect(res.status).toBe(200);
    expect(res.body.data.company.displayName).toBe('Acme Rockets');
    expect(res.body.data.company.city).toBe('Amman');
  });

  it('lets ADMIN update the profile', async () => {
    const res = await request(app)
      .patch('/api/v1/company/profile')
      .set(authHeader(tenant.tokens.admin))
      .send({ industry: 'Aerospace' });
    expect(res.status).toBe(200);
    expect(res.body.data.company.industry).toBe('Aerospace');
  });

  it('forbids AGENT from updating the profile', async () => {
    const res = await request(app)
      .patch('/api/v1/company/profile')
      .set(authHeader(tenant.tokens.agent))
      .send({ industry: 'Aerospace' });
    expect(res.status).toBe(403);
  });

  it('rejects invalid data (bad email/url)', async () => {
    const res = await request(app)
      .patch('/api/v1/company/profile')
      .set(authHeader(tenant.tokens.owner))
      .send({ email: 'not-an-email', websiteUrl: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  it('rejects unknown/protected fields (slug, status)', async () => {
    const res = await request(app)
      .patch('/api/v1/company/profile')
      .set(authHeader(tenant.tokens.owner))
      .send({ slug: 'hacked', status: 'SUSPENDED' });
    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated updates', async () => {
    const res = await request(app)
      .patch('/api/v1/company/profile')
      .send({ displayName: 'x' });
    expect(res.status).toBe(401);
  });
});
