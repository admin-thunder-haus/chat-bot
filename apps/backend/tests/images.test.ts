import request from 'supertest';
import { createApp } from '../src/app';
import { authHeader, setupTenant, type Tenant } from './helpers';

/**
 * Image upload + public serving. Uploads are OWNER/ADMIN only and
 * tenant-scoped; serving is deliberately public (channel providers fetch
 * attachment URLs anonymously).
 */

const app = createApp();

// Minimal valid 1x1 transparent PNG.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let acme: Tenant;
let globex: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
});

function uploadImage(token: string, filename = 'photo.png', type = 'image/png') {
  return request(app)
    .post('/api/v1/images')
    .set(authHeader(token))
    .attach('file', PNG_1PX, { filename, contentType: type });
}

describe('POST /api/v1/images', () => {
  it('OWNER can upload a PNG and receives a public URL', async () => {
    const res = await uploadImage(acme.tokens.owner);

    expect(res.status).toBe(201);
    const image = res.body.data.image;
    expect(image.url).toContain(`/api/v1/public/images/${image.id}`);
    expect(image.mimeType).toBe('image/png');
    expect(image.sizeBytes).toBe(PNG_1PX.length);
  });

  it('AGENT cannot upload', async () => {
    const res = await uploadImage(acme.tokens.agent);
    expect(res.status).toBe(403);
  });

  it('rejects non-image uploads', async () => {
    const res = await request(app)
      .post('/api/v1/images')
      .set(authHeader(acme.tokens.owner))
      .attach('file', Buffer.from('plain text'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toBe(400);
  });

  it('rejects requests without a file', async () => {
    const res = await request(app)
      .post('/api/v1/images')
      .set(authHeader(acme.tokens.owner));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/public/images/:imageId', () => {
  it('serves the uploaded bytes without authentication', async () => {
    const uploaded = await uploadImage(acme.tokens.owner);
    const id = uploaded.body.data.image.id as string;

    const res = await request(app).get(`/api/v1/public/images/${id}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['cache-control']).toContain('max-age=86400');
    expect(Buffer.compare(res.body as Buffer, PNG_1PX)).toBe(0);
  });

  it('returns 404 for an unknown image', async () => {
    const res = await request(app).get(
      '/api/v1/public/images/00000000-0000-4000-8000-000000000000',
    );
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/images/:imageId', () => {
  it('deletes own image; other tenants cannot', async () => {
    const uploaded = await uploadImage(acme.tokens.owner);
    const id = uploaded.body.data.image.id as string;

    const foreign = await request(app)
      .delete(`/api/v1/images/${id}`)
      .set(authHeader(globex.tokens.owner));
    expect(foreign.status).toBe(404);

    const own = await request(app)
      .delete(`/api/v1/images/${id}`)
      .set(authHeader(acme.tokens.owner));
    expect(own.status).toBe(200);

    const gone = await request(app).get(`/api/v1/public/images/${id}`);
    expect(gone.status).toBe(404);
  });
});
