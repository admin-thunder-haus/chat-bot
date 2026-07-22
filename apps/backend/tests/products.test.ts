import request from 'supertest';
import { createApp } from '../src/app';
import { authHeader, setupTenant, type Tenant } from './helpers';
import { makeXlsxBuffer } from './excel-helpers';
import { prisma } from './setup';

/**
 * Products module: CRUD + RBAC + multi-tenant isolation + Excel import.
 * Mirrors services.test.ts so both catalog modules stay behaviorally aligned.
 */

const app = createApp();

const validProduct = {
  name: 'Espresso Machine',
  description: 'Compact 15-bar espresso machine.',
  sku: 'EM-100',
  category: 'Appliances',
  price: 249.5,
  currency: 'JOD',
  stockQuantity: 12,
  imageUrl: 'https://example.com/em100.jpg',
};

let acme: Tenant;
let globex: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
});

function createProduct(token: string, body: Record<string, unknown>) {
  return request(app)
    .post('/api/v1/products')
    .set(authHeader(token))
    .send(body);
}

describe('Products CRUD & authorization', () => {
  it('OWNER can create a product (price serialized as string)', async () => {
    const res = await createProduct(acme.tokens.owner, validProduct);
    expect(res.status).toBe(201);
    expect(res.body.data.product.price).toBe('249.5');
    expect(res.body.data.product.imageUrl).toBe('https://example.com/em100.jpg');
    expect(res.body.data.product.stockQuantity).toBe(12);
  });

  it('ADMIN can create; AGENT cannot', async () => {
    const admin = await createProduct(acme.tokens.admin, {
      ...validProduct,
      name: 'Grinder',
      sku: 'GR-1',
    });
    expect(admin.status).toBe(201);

    const agent = await createProduct(acme.tokens.agent, {
      ...validProduct,
      name: 'Nope',
      sku: 'NO-1',
    });
    expect(agent.status).toBe(403);
  });

  it('allows a product without a price (price on request)', async () => {
    const res = await createProduct(acme.tokens.owner, {
      name: 'Custom Bundle',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.product.price).toBeNull();
  });

  it('rejects a duplicate name with 409', async () => {
    await createProduct(acme.tokens.owner, validProduct);
    const res = await createProduct(acme.tokens.owner, {
      ...validProduct,
      sku: 'EM-101',
    });
    expect(res.status).toBe(409);
  });

  it('rejects a duplicate SKU with 409', async () => {
    await createProduct(acme.tokens.owner, validProduct);
    const res = await createProduct(acme.tokens.owner, {
      ...validProduct,
      name: 'Different Name',
    });
    expect(res.status).toBe(409);
  });

  it('same name in another company is fine', async () => {
    await createProduct(acme.tokens.owner, validProduct);
    const res = await createProduct(globex.tokens.owner, validProduct);
    expect(res.status).toBe(201);
  });

  it('rejects an invalid image URL', async () => {
    const res = await createProduct(acme.tokens.owner, {
      ...validProduct,
      imageUrl: 'javascript:alert(1)',
    });
    expect(res.status).toBe(400);
  });

  it('updates a product and clears price with null', async () => {
    const created = await createProduct(acme.tokens.owner, validProduct);
    const id = created.body.data.product.id;

    const res = await request(app)
      .patch(`/api/v1/products/${id}`)
      .set(authHeader(acme.tokens.admin))
      .send({ price: null, stockQuantity: 0 });

    expect(res.status).toBe(200);
    expect(res.body.data.product.price).toBeNull();
    expect(res.body.data.product.stockQuantity).toBe(0);
  });

  it('toggles status and deletes', async () => {
    const created = await createProduct(acme.tokens.owner, validProduct);
    const id = created.body.data.product.id;

    const off = await request(app)
      .patch(`/api/v1/products/${id}/status`)
      .set(authHeader(acme.tokens.owner))
      .send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.data.product.isActive).toBe(false);

    const del = await request(app)
      .delete(`/api/v1/products/${id}`)
      .set(authHeader(acme.tokens.owner));
    expect(del.status).toBe(200);

    const gone = await request(app)
      .get(`/api/v1/products/${id}`)
      .set(authHeader(acme.tokens.owner));
    expect(gone.status).toBe(404);
  });
});

describe('Products listing', () => {
  beforeEach(async () => {
    await prisma.product.createMany({
      data: [
        {
          companyId: acme.company.id,
          name: 'Alpha',
          category: 'Tools',
          price: '10',
          sortOrder: 2,
        },
        {
          companyId: acme.company.id,
          name: 'Beta',
          category: 'Tools',
          price: '20',
          sortOrder: 1,
          isActive: false,
        },
        {
          companyId: acme.company.id,
          name: 'Gamma',
          category: 'Kitchen',
          sku: 'KG-9',
          sortOrder: 3,
        },
      ],
    });
  });

  it('paginates and sorts by sortOrder', async () => {
    const res = await request(app)
      .get('/api/v1/products?limit=2')
      .set(authHeader(acme.tokens.agent));
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((p: { name: string }) => p.name)).toEqual([
      'Beta',
      'Alpha',
    ]);
    expect(res.body.data.pagination.total).toBe(3);
  });

  it('filters by isActive and category, searches by sku', async () => {
    const active = await request(app)
      .get('/api/v1/products?isActive=true')
      .set(authHeader(acme.tokens.agent));
    expect(active.body.data.pagination.total).toBe(2);

    const kitchen = await request(app)
      .get('/api/v1/products?category=kitchen')
      .set(authHeader(acme.tokens.agent));
    expect(kitchen.body.data.pagination.total).toBe(1);

    const bySku = await request(app)
      .get('/api/v1/products?search=KG-9')
      .set(authHeader(acme.tokens.agent));
    expect(bySku.body.data.items[0].name).toBe('Gamma');
  });
});

describe('Products multi-tenant isolation', () => {
  it('never exposes another tenant’s products', async () => {
    const created = await createProduct(acme.tokens.owner, validProduct);
    const id = created.body.data.product.id;

    const list = await request(app)
      .get('/api/v1/products')
      .set(authHeader(globex.tokens.owner));
    expect(list.body.data.pagination.total).toBe(0);

    const get = await request(app)
      .get(`/api/v1/products/${id}`)
      .set(authHeader(globex.tokens.owner));
    expect(get.status).toBe(404);

    const update = await request(app)
      .patch(`/api/v1/products/${id}`)
      .set(authHeader(globex.tokens.owner))
      .send({ name: 'Hijacked' });
    expect(update.status).toBe(404);

    const del = await request(app)
      .delete(`/api/v1/products/${id}`)
      .set(authHeader(globex.tokens.owner));
    expect(del.status).toBe(404);
  });
});

describe('Products Excel import', () => {
  const HEADERS = [
    'name',
    'description',
    'sku',
    'category',
    'price',
    'currency',
    'stockQuantity',
    'imageUrl',
    'isActive',
    'sortOrder',
  ];

  function importPreview(token: string, buffer: Buffer) {
    return request(app)
      .post('/api/v1/products/import/preview')
      .set(authHeader(token))
      .attach('file', buffer, 'products.xlsx');
  }

  function importCommit(token: string, buffer: Buffer, mode: string) {
    return request(app)
      .post('/api/v1/products/import')
      .set(authHeader(token))
      .attach('file', buffer, 'products.xlsx')
      .field('mode', mode);
  }

  async function validBuffer() {
    return makeXlsxBuffer(HEADERS, [
      [
        'Espresso Machine',
        'Compact machine',
        'EM-100',
        'Appliances',
        249.5,
        'JOD',
        12,
        'https://example.com/em100.jpg',
        true,
        1,
      ],
      ['Coffee Beans 1kg', null, 'CB-1', 'Consumables', 9.9, null, 0, null, 'yes', 2],
      ['Gift Card', 'Any amount', null, null, null, 'USD', null, null, null, 3],
    ]);
  }

  it('previews valid rows including image URLs', async () => {
    const res = await importPreview(acme.tokens.admin, await validBuffer());
    expect(res.status).toBe(200);
    expect(res.body.data.summary).toEqual({
      totalRows: 3,
      validRows: 3,
      invalidRows: 0,
    });
    expect(res.body.data.rows[0].data.imageUrl).toBe(
      'https://example.com/em100.jpg',
    );
    expect(await prisma.product.count()).toBe(0);
  });

  it('flags duplicate SKUs within the file', async () => {
    const buffer = await makeXlsxBuffer(HEADERS, [
      ['A', null, 'SKU-1', null, 1, null, null, null, true, 1],
      ['B', null, 'sku-1', null, 2, null, null, null, true, 2],
    ]);
    const res = await importPreview(acme.tokens.owner, buffer);
    expect(res.body.data.summary.invalidRows).toBe(1);
    expect(JSON.stringify(res.body.data.rows[1].errors)).toContain('sku');
  });

  it('merge upserts by name; replace wipes first', async () => {
    await prisma.product.create({
      data: {
        companyId: acme.company.id,
        name: 'Espresso Machine',
        price: '999',
      },
    });

    const merge = await importCommit(
      acme.tokens.owner,
      await validBuffer(),
      'merge',
    );
    expect(merge.status).toBe(200);
    expect(merge.body.data).toEqual({
      created: 2,
      updated: 1,
      deleted: 0,
      total: 3,
    });

    const replace = await importCommit(
      acme.tokens.owner,
      await validBuffer(),
      'replace',
    );
    expect(replace.status).toBe(200);
    expect(replace.body.data.deleted).toBe(3);
    expect(replace.body.data.created).toBe(3);
    expect(
      await prisma.product.count({ where: { companyId: acme.company.id } }),
    ).toBe(3);
  });

  it('is forbidden for AGENT', async () => {
    const res = await importCommit(
      acme.tokens.agent,
      await validBuffer(),
      'merge',
    );
    expect(res.status).toBe(403);
  });
});
