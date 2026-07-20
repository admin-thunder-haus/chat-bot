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

function createEntry(token: string, body: Record<string, unknown>) {
  return request(app)
    .post('/api/v1/knowledge-base')
    .set(authHeader(token))
    .send(body);
}

const validEntry = {
  title: 'Return Policy',
  content: 'Returns are accepted within 14 days.',
  category: 'Policies',
  tags: ['returns', 'policy'],
};

describe('Knowledge base CRUD & authorization', () => {
  it('OWNER/ADMIN can create; AGENT cannot but can read', async () => {
    expect((await createEntry(acme.tokens.owner, validEntry)).status).toBe(201);
    expect(
      (await createEntry(acme.tokens.admin, { ...validEntry, title: 'T2' }))
        .status,
    ).toBe(201);
    expect(
      (await createEntry(acme.tokens.agent, { ...validEntry, title: 'T3' }))
        .status,
    ).toBe(403);

    const read = await request(app)
      .get('/api/v1/knowledge-base')
      .set(authHeader(acme.tokens.agent));
    expect(read.status).toBe(200);
    expect(read.body.data.items.length).toBe(2);
  });

  it('normalizes and de-duplicates tags', async () => {
    const res = await createEntry(acme.tokens.owner, {
      ...validEntry,
      title: 'Tagged',
      tags: ['A', 'a', ' b ', 'b'],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.entry.tags).toEqual(['A', 'b']);
  });

  it('validates required fields and content length', async () => {
    expect((await createEntry(acme.tokens.owner, { title: '' })).status).toBe(400);
    expect(
      (
        await createEntry(acme.tokens.owner, {
          title: 'X',
          content: 'a'.repeat(20001),
        })
      ).status,
    ).toBe(400);
  });

  it('updates, toggles status, and deletes', async () => {
    const created = await createEntry(acme.tokens.owner, validEntry);
    const id = created.body.data.entry.id;

    const upd = await request(app)
      .patch(`/api/v1/knowledge-base/${id}`)
      .set(authHeader(acme.tokens.owner))
      .send({ title: 'Updated Title' });
    expect(upd.body.data.entry.title).toBe('Updated Title');

    const status = await request(app)
      .patch(`/api/v1/knowledge-base/${id}/status`)
      .set(authHeader(acme.tokens.admin))
      .send({ isActive: false });
    expect(status.body.data.entry.isActive).toBe(false);

    const del = await request(app)
      .delete(`/api/v1/knowledge-base/${id}`)
      .set(authHeader(acme.tokens.owner));
    expect(del.status).toBe(200);
  });

  it('AGENT cannot modify', async () => {
    const created = await createEntry(acme.tokens.owner, validEntry);
    const id = created.body.data.entry.id;
    expect(
      (
        await request(app)
          .patch(`/api/v1/knowledge-base/${id}`)
          .set(authHeader(acme.tokens.agent))
          .send({ title: 'x' })
      ).status,
    ).toBe(403);
  });

  it('searches title/content and filters by tag', async () => {
    await createEntry(acme.tokens.owner, {
      ...validEntry,
      title: 'Shipping',
      content: 'We deliver in 2-4 days.',
      tags: ['shipping'],
    });
    await createEntry(acme.tokens.owner, validEntry);

    const search = await request(app)
      .get('/api/v1/knowledge-base?search=deliver')
      .set(authHeader(acme.tokens.owner));
    expect(search.body.data.items.length).toBe(1);
    expect(search.body.data.items[0].title).toBe('Shipping');

    const byTag = await request(app)
      .get('/api/v1/knowledge-base?tag=returns')
      .set(authHeader(acme.tokens.owner));
    expect(byTag.body.data.items.length).toBe(1);
    expect(byTag.body.data.items[0].title).toBe('Return Policy');
  });

  it('reorders entries', async () => {
    const a = await createEntry(acme.tokens.owner, { ...validEntry, title: 'A' });
    const b = await createEntry(acme.tokens.owner, { ...validEntry, title: 'B' });
    const res = await request(app)
      .patch('/api/v1/knowledge-base/reorder')
      .set(authHeader(acme.tokens.owner))
      .send({
        items: [
          { id: b.body.data.entry.id, sortOrder: 1 },
          { id: a.body.data.entry.id, sortOrder: 2 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.entries[0].title).toBe('B');
  });

  it('is isolated between tenants', async () => {
    const created = await createEntry(acme.tokens.owner, validEntry);
    const id = created.body.data.entry.id;
    expect(
      (
        await request(app)
          .get(`/api/v1/knowledge-base/${id}`)
          .set(authHeader(globex.tokens.owner))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch(`/api/v1/knowledge-base/${id}`)
          .set(authHeader(globex.tokens.owner))
          .send({ title: 'x' })
      ).status,
    ).toBe(404);
  });
});
