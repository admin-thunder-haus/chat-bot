import request from 'supertest';
import { createApp } from '../src/app';
import { authHeader, setupTenant, type Tenant } from './helpers';
import { makeXlsxBuffer } from './excel-helpers';
import { prisma } from './setup';

/**
 * Excel import for services: preview (validation, duplicates, no writes) and
 * commit (merge vs replace, image URLs, RBAC, cross-checks).
 */

const app = createApp();

const HEADERS = [
  'name',
  'description',
  'price',
  'currency',
  'priceType',
  'durationMinutes',
  'imageUrl',
  'isActive',
  'sortOrder',
];

let acme: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
});

function preview(token: string, buffer: Buffer, filename = 'services.xlsx') {
  return request(app)
    .post('/api/v1/services/import/preview')
    .set(authHeader(token))
    .attach('file', buffer, filename);
}

function commit(
  token: string,
  buffer: Buffer,
  mode?: string,
  filename = 'services.xlsx',
) {
  let req = request(app)
    .post('/api/v1/services/import')
    .set(authHeader(token))
    .attach('file', buffer, filename);
  if (mode) req = req.field('mode', mode);
  return req;
}

async function validBuffer() {
  return makeXlsxBuffer(HEADERS, [
    [
      'Haircut',
      'Classic haircut',
      15,
      'JOD',
      'FIXED',
      30,
      'https://example.com/haircut.jpg',
      true,
      1,
    ],
    ['Consultation', null, null, null, 'FREE', null, null, 'yes', 2],
    ['Custom Work', 'Per project', null, 'USD', 'contact us', null, null, null, 3],
  ]);
}

describe('POST /api/v1/services/import/preview', () => {
  it('parses valid rows and reports a clean summary without writing', async () => {
    const res = await preview(acme.tokens.admin, await validBuffer());

    expect(res.status).toBe(200);
    expect(res.body.data.summary).toEqual({
      totalRows: 3,
      validRows: 3,
      invalidRows: 0,
    });
    expect(res.body.data.rows[0].data.name).toBe('Haircut');
    expect(res.body.data.rows[0].data.imageUrl).toBe(
      'https://example.com/haircut.jpg',
    );
    // Case/spacing-tolerant priceType parsing ("contact us" -> CONTACT_US).
    expect(res.body.data.rows[2].data.priceType).toBe('CONTACT_US');

    // Preview never writes.
    expect(await prisma.businessService.count()).toBe(0);
  });

  it('flags invalid rows (missing name, bad price, bad URL) with row errors', async () => {
    const buffer = await makeXlsxBuffer(HEADERS, [
      [null, 'No name', 10, 'JOD', 'FIXED', null, null, true, 1],
      ['Priced Missing', null, null, 'JOD', 'FIXED', null, null, true, 2],
      ['Bad Url', null, 5, 'JOD', 'FIXED', null, 'not-a-url', true, 3],
    ]);
    const res = await preview(acme.tokens.owner, buffer);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.invalidRows).toBe(3);
    const errorsByRow = Object.fromEntries(
      res.body.data.rows.map((r: { rowNumber: number; errors: unknown[] }) => [
        r.rowNumber,
        r.errors,
      ]),
    );
    expect(JSON.stringify(errorsByRow['2'])).toContain('Name is required');
    expect(JSON.stringify(errorsByRow['3'])).toContain('Price is required');
    expect(JSON.stringify(errorsByRow['4'])).toContain('URL');
  });

  it('flags duplicate names within the file', async () => {
    const buffer = await makeXlsxBuffer(HEADERS, [
      ['Same', null, 5, 'JOD', 'FIXED', null, null, true, 1],
      ['same', null, 9, 'JOD', 'FIXED', null, null, true, 2],
    ]);
    const res = await preview(acme.tokens.owner, buffer);
    expect(res.body.data.summary.validRows).toBe(1);
    expect(JSON.stringify(res.body.data.rows[1].errors)).toContain('Duplicate');
  });

  it('rejects non-xlsx uploads', async () => {
    const res = await preview(
      acme.tokens.owner,
      Buffer.from('name\nfoo'),
      'services.csv',
    );
    expect(res.status).toBe(400);
  });

  it('requires a file', async () => {
    const res = await request(app)
      .post('/api/v1/services/import/preview')
      .set(authHeader(acme.tokens.owner));
    expect(res.status).toBe(400);
  });

  it('is forbidden for AGENT', async () => {
    const res = await preview(acme.tokens.agent, await validBuffer());
    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/services/import', () => {
  it('merge mode creates new and updates existing services by name', async () => {
    await prisma.businessService.create({
      data: {
        companyId: acme.company.id,
        name: 'Haircut',
        price: '99',
        priceType: 'FIXED',
      },
    });

    const res = await commit(acme.tokens.admin, await validBuffer(), 'merge');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      created: 2,
      updated: 1,
      deleted: 0,
      total: 3,
    });

    const haircut = await prisma.businessService.findFirst({
      where: { companyId: acme.company.id, name: 'Haircut' },
    });
    expect(haircut?.price?.toString()).toBe('15');
    expect(haircut?.imageUrl).toBe('https://example.com/haircut.jpg');
  });

  it('replace mode deletes everything first', async () => {
    await prisma.businessService.createMany({
      data: [
        { companyId: acme.company.id, name: 'Old A', priceType: 'FREE' },
        { companyId: acme.company.id, name: 'Old B', priceType: 'FREE' },
      ],
    });

    const res = await commit(acme.tokens.owner, await validBuffer(), 'replace');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      created: 3,
      updated: 0,
      deleted: 2,
      total: 3,
    });

    const names = (
      await prisma.businessService.findMany({
        where: { companyId: acme.company.id },
      })
    ).map((s) => s.name);
    expect(names).not.toContain('Old A');
    expect(names).toContain('Haircut');
  });

  it('replace never touches another tenant', async () => {
    const globex = await setupTenant('globex');
    await prisma.businessService.create({
      data: { companyId: globex.company.id, name: 'Theirs', priceType: 'FREE' },
    });

    await commit(acme.tokens.owner, await validBuffer(), 'replace');

    expect(
      await prisma.businessService.count({
        where: { companyId: globex.company.id },
      }),
    ).toBe(1);
  });

  it('rejects a commit containing invalid rows and writes nothing', async () => {
    const buffer = await makeXlsxBuffer(HEADERS, [
      ['Fine', null, 5, 'JOD', 'FIXED', null, null, true, 1],
      [null, 'broken row', null, null, null, null, null, null, 2],
    ]);
    const res = await commit(acme.tokens.owner, buffer, 'merge');
    expect(res.status).toBe(400);
    expect(await prisma.businessService.count()).toBe(0);
  });

  it('defaults to merge mode when mode is omitted', async () => {
    const res = await commit(acme.tokens.owner, await validBuffer());
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(0);
  });

  it('is forbidden for AGENT', async () => {
    const res = await commit(acme.tokens.agent, await validBuffer(), 'merge');
    expect(res.status).toBe(403);
  });
});
