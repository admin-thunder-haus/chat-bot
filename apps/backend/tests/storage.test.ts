import crypto from 'node:crypto';
import request from 'supertest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createApp } from '../src/app';
import { isS3StorageEnabled, s3StorageConfig } from '../src/config/env';
import { dbStorageProvider } from '../src/modules/storage/db-storage.provider';
import { sha256Hex, signS3Request } from '../src/modules/storage/s3-signature';
import {
  s3StorageProvider,
  setS3TransportForTesting,
} from '../src/modules/storage/s3-storage.provider';
import {
  imageStorageKey,
  knowledgeDocumentStorageKey,
  storageService,
} from '../src/modules/storage/storage.service';
import {
  decideRow,
  migrateTable,
  SPECS,
} from '../scripts/migrate-storage-to-s3';
import { authHeader, setupTenant, type Tenant } from './helpers';
import { drainJobs } from './jobs-helpers';
import { prisma } from './setup';
import { installFakeS3, uninstallFakeS3, type FakeS3Bucket } from './storage-helpers';

/**
 * File storage abstraction: the DB provider (default), the S3-compatible
 * provider, the selector between them, and the public image route in BOTH modes.
 *
 * No test here reaches a real bucket: the S3 transport is injected and global
 * fetch is replaced with a thrower while S3 mode is installed (storage-helpers).
 */

const app = createApp();

// Minimal valid 1x1 transparent PNG (same fixture as images.test.ts).
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let acme: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
});

afterEach(() => {
  // Always restore the default mode, even for the DB-mode tests: a leaked S3
  // env var would silently change how every later suite stores files.
  uninstallFakeS3();
});

describe('provider selection', () => {
  it('defaults to the Postgres provider when no S3 env vars are set', () => {
    expect(process.env.S3_ENDPOINT).toBeUndefined();
    expect(isS3StorageEnabled()).toBe(false);
    expect(s3StorageConfig()).toBeNull();
    expect(storageService.providerName()).toBe('db');
  });

  it('stays on Postgres when the S3 config is only partly set', () => {
    // A half-configured bucket must never win the selection: uploads would
    // succeed and reads would 404.
    process.env.S3_ENDPOINT = 'https://fake-account.r2.example.invalid';
    process.env.S3_BUCKET = 'test-bucket';
    try {
      expect(s3StorageConfig()).toBeNull();
      expect(isS3StorageEnabled()).toBe(false);
    } finally {
      delete process.env.S3_ENDPOINT;
      delete process.env.S3_BUCKET;
    }
  });

  it('selects the S3 provider once every variable is present', () => {
    installFakeS3();
    expect(isS3StorageEnabled()).toBe(true);
    expect(storageService.providerName()).toBe('s3');
    expect(s3StorageConfig()).toMatchObject({
      bucket: 'test-bucket',
      region: 'auto',
    });
  });
});

describe('db storage provider', () => {
  it('round-trips bytes through the row itself, unchanged', async () => {
    const { inlineData } = await dbStorageProvider.put({
      key: 'images/company/id',
      contentType: 'image/png',
      data: PNG_1PX,
    });

    // Bit-for-bit: what goes into the `data` column is exactly the uploaded
    // buffer, which is what the pre-existing code wrote.
    expect(Buffer.compare(Buffer.from(inlineData), PNG_1PX)).toBe(0);

    const readBack = await dbStorageProvider.get({
      key: 'images/company/id',
      inline: inlineData,
    });
    expect(Buffer.compare(readBack, PNG_1PX)).toBe(0);
  });

  it('has no public URL of its own and deletes nothing out of band', async () => {
    expect(dbStorageProvider.publicUrl('images/a/b')).toBeNull();
    await expect(dbStorageProvider.delete('images/a/b')).resolves.toBeUndefined();
  });
});

describe('storage keys', () => {
  it('derives per-tenant keys so a foreign id cannot target another tenant', () => {
    expect(imageStorageKey('company-1', 'image-1')).toBe(
      'images/company-1/image-1',
    );
    expect(knowledgeDocumentStorageKey('company-1', 'doc-1')).toBe(
      'knowledge-documents/company-1/doc-1',
    );
    // Same row id, different tenant => different object.
    expect(imageStorageKey('company-2', 'image-1')).not.toBe(
      imageStorageKey('company-1', 'image-1'),
    );
  });
});

describe('SigV4 signing', () => {
  /**
   * The AWS documented "GET Object" example (Signature Version 4 examples):
   * examplebucket/test.txt, Range: bytes=0-9, 20130524T000000Z, us-east-1. The
   * published SHA-256 of its canonical request is the constant below — asserting
   * against it proves the canonicalisation, and re-deriving the signature from it
   * proves the HMAC chain.
   */
  const AWS_EXAMPLE = {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    amzDate: '20130524T000000Z',
    dateStamp: '20130524',
    canonicalRequestSha256:
      '7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972',
  };

  function hmac(key: crypto.BinaryLike, data: string): Buffer {
    return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
  }

  it('matches the AWS test vector for a GET Object request', () => {
    const signed = signS3Request({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      region: AWS_EXAMPLE.region,
      accessKeyId: AWS_EXAMPLE.accessKeyId,
      secretAccessKey: AWS_EXAMPLE.secretAccessKey,
      headers: { Range: 'bytes=0-9' },
      now: new Date('2013-05-24T00:00:00Z'),
    });

    const scope = `${AWS_EXAMPLE.dateStamp}/${AWS_EXAMPLE.region}/s3/aws4_request`;
    const signingKey = hmac(
      hmac(
        hmac(
          hmac(`AWS4${AWS_EXAMPLE.secretAccessKey}`, AWS_EXAMPLE.dateStamp),
          AWS_EXAMPLE.region,
        ),
        's3',
      ),
      'aws4_request',
    );
    const expectedSignature = hmac(
      signingKey,
      [
        'AWS4-HMAC-SHA256',
        AWS_EXAMPLE.amzDate,
        scope,
        AWS_EXAMPLE.canonicalRequestSha256,
      ].join('\n'),
    ).toString('hex');

    expect(signed.headers.Authorization).toBe(
      `AWS4-HMAC-SHA256 Credential=${AWS_EXAMPLE.accessKeyId}/${scope}, ` +
        `SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ` +
        `Signature=${expectedSignature}`,
    );
    expect(signed.headers['x-amz-date']).toBe(AWS_EXAMPLE.amzDate);
  });

  it('hashes the payload and signs the content type for a PUT', () => {
    const body = Buffer.from('hello bucket');
    const signed = signS3Request({
      method: 'PUT',
      url: 'https://fake-account.r2.example.invalid/test-bucket/images/c/i',
      body,
      region: 'auto',
      accessKeyId: 'test-access-key-id',
      secretAccessKey: 'test-secret-access-key',
      headers: { 'Content-Type': 'image/png' },
      now: new Date('2026-07-26T10:15:30Z'),
    });

    expect(signed.headers['x-amz-content-sha256']).toBe(sha256Hex(body));
    expect(signed.headers.Authorization).toContain(
      'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date',
    );
    expect(signed.headers.Authorization).toContain(
      'Credential=test-access-key-id/20260726/auto/s3/aws4_request',
    );
  });

  it('hashes an empty body and is sensitive to every signed input', () => {
    const base = {
      method: 'DELETE',
      url: 'https://fake-account.r2.example.invalid/test-bucket/images/c/i',
      region: 'auto',
      accessKeyId: 'test-access-key-id',
      secretAccessKey: 'test-secret-access-key',
      now: new Date('2026-07-26T10:15:30Z'),
    };
    const signed = signS3Request(base);
    // SHA-256 of the empty string, which is what S3 expects for a bodyless call.
    expect(signed.headers['x-amz-content-sha256']).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );

    const signature = (headers: Record<string, string>) =>
      headers.Authorization.split('Signature=')[1];

    // Deterministic for identical inputs...
    expect(signature(signS3Request(base).headers)).toBe(
      signature(signed.headers),
    );
    // ...and different for a different key, region or path.
    expect(
      signature(signS3Request({ ...base, secretAccessKey: 'other' }).headers),
    ).not.toBe(signature(signed.headers));
    expect(
      signature(signS3Request({ ...base, region: 'eu-central-1' }).headers),
    ).not.toBe(signature(signed.headers));
    expect(
      signature(
        signS3Request({ ...base, url: `${base.url}-other` }).headers,
      ),
    ).not.toBe(signature(signed.headers));
  });
});

describe('s3 storage provider', () => {
  let bucket: FakeS3Bucket;

  beforeEach(() => {
    bucket = installFakeS3();
  });

  it('PUTs the object path-style with a signed authorization header', async () => {
    const result = await s3StorageProvider.put({
      key: 'images/company-1/image-1',
      contentType: 'image/png',
      data: PNG_1PX,
    });

    // The row keeps NO bytes: the empty column is the "lives in the bucket" mark.
    expect(result.inlineData.length).toBe(0);

    expect(bucket.requests).toHaveLength(1);
    const req = bucket.requests[0];
    expect(req.method).toBe('PUT');
    expect(req.url).toBe(
      'https://fake-account.r2.example.invalid/test-bucket/images/company-1/image-1',
    );
    expect(req.headers.Authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=test-access-key-id\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/,
    );
    expect(req.headers['x-amz-content-sha256']).toBe(sha256Hex(PNG_1PX));
    expect(req.headers['Content-Type']).toBe('image/png');
    expect(bucket.objects.get('images/company-1/image-1')?.body).toEqual(PNG_1PX);
  });

  it('GETs the object back byte-identically', async () => {
    await s3StorageProvider.put({
      key: 'images/company-1/image-1',
      contentType: 'image/png',
      data: PNG_1PX,
    });

    const bytes = await s3StorageProvider.get({
      key: 'images/company-1/image-1',
      inline: new Uint8Array(0),
    });
    expect(Buffer.compare(bytes, PNG_1PX)).toBe(0);
    expect(bucket.requests.map((r) => r.method)).toEqual(['PUT', 'GET']);
  });

  it('prefers a row that still has its inline bytes (not yet migrated)', async () => {
    // This is what makes flipping the env vars on a live database safe.
    const bytes = await s3StorageProvider.get({
      key: 'images/company-1/never-uploaded',
      inline: new Uint8Array(PNG_1PX),
    });
    expect(Buffer.compare(bytes, PNG_1PX)).toBe(0);
    expect(bucket.requests).toHaveLength(0);
  });

  it('DELETEs the object and tolerates one that is already gone', async () => {
    await s3StorageProvider.put({
      key: 'images/company-1/image-1',
      contentType: 'image/png',
      data: PNG_1PX,
    });
    await s3StorageProvider.delete('images/company-1/image-1');
    expect(bucket.objects.has('images/company-1/image-1')).toBe(false);

    await expect(
      s3StorageProvider.delete('images/company-1/image-1'),
    ).resolves.toBeUndefined();
  });

  it('404 on read is a not-found, other failures are internal errors', async () => {
    await expect(
      s3StorageProvider.get({ key: 'images/c/missing', inline: new Uint8Array(0) }),
    ).rejects.toMatchObject({ statusCode: 404 });

    setS3TransportForTesting(() =>
      Promise.resolve({ status: 500, body: Buffer.from('<Error/>') }),
    );
    await expect(
      s3StorageProvider.put({
        key: 'images/c/i',
        contentType: 'image/png',
        data: PNG_1PX,
      }),
    ).rejects.toMatchObject({ statusCode: 500 });
  });

  it('resolves a provider-side public URL from S3_PUBLIC_BASE_URL', () => {
    expect(s3StorageProvider.publicUrl('images/company-1/image-1')).toBe(
      'https://files.example.invalid/images/company-1/image-1',
    );
  });
});

describe('public image route', () => {
  function uploadImage(token: string) {
    return request(app)
      .post('/api/v1/images')
      .set(authHeader(token))
      .attach('file', PNG_1PX, {
        filename: 'photo.png',
        contentType: 'image/png',
      });
  }

  it('DB mode: serves inline bytes with the cross-origin CORP header', async () => {
    const uploaded = await uploadImage(acme.tokens.owner);
    const id = uploaded.body.data.image.id as string;

    const stored = await prisma.storedImage.findUnique({ where: { id } });
    // Unchanged default: the bytes are in Postgres.
    expect(Buffer.from(stored!.data)).toEqual(PNG_1PX);

    const res = await request(app).get(`/api/v1/public/images/${id}`);
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, PNG_1PX)).toBe(0);
    // helmet() defaults CORP to same-origin, which blocks the image in BROWSERS
    // only — curl and this suite's own fetches look fine — so it is asserted
    // explicitly in both modes.
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('S3 mode: proxies bucket bytes and KEEPS the cross-origin CORP header', async () => {
    const bucket = installFakeS3();

    const uploaded = await uploadImage(acme.tokens.owner);
    expect(uploaded.status).toBe(201);
    const id = uploaded.body.data.image.id as string;

    // The URL handed out is still OUR route — it is persisted in product/service
    // rows and sent to Meta, so it must not become a bucket hostname.
    expect(uploaded.body.data.image.url).toContain(
      `/api/v1/public/images/${id}`,
    );

    // Postgres holds no bytes; the bucket does.
    const stored = await prisma.storedImage.findUnique({ where: { id } });
    expect(stored!.data.length).toBe(0);
    const key = imageStorageKey(acme.company.id, id);
    expect(bucket.objects.get(key)?.body).toEqual(PNG_1PX);

    const res = await request(app).get(`/api/v1/public/images/${id}`);
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, PNG_1PX)).toBe(0);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('S3 mode: deleting the image drops the object too', async () => {
    const bucket = installFakeS3();
    const uploaded = await uploadImage(acme.tokens.owner);
    const id = uploaded.body.data.image.id as string;
    const key = imageStorageKey(acme.company.id, id);
    expect(bucket.objects.has(key)).toBe(true);

    const del = await request(app)
      .delete(`/api/v1/images/${id}`)
      .set(authHeader(acme.tokens.owner));
    expect(del.status).toBe(200);
    expect(bucket.objects.has(key)).toBe(false);
  });
});

describe('knowledge documents in S3 mode', () => {
  /** Real one-page PDF, so extraction has actual text to find. */
  async function makePdf(line: string): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText(line, { x: 50, y: 720, size: 12, font });
    return Buffer.from(await doc.save());
  }

  it('uploads to the bucket, extracts from it, and downloads it back', async () => {
    const bucket = installFakeS3();
    const pdf = await makePdf('Zorbification warranty lasts 24 months.');

    const uploaded = await request(app)
      .post('/api/v1/knowledge-documents')
      .set(authHeader(acme.tokens.owner))
      .attach('files', pdf, {
        filename: 'warranty.pdf',
        contentType: 'application/pdf',
      });
    expect(uploaded.status).toBe(201);
    const id = uploaded.body.data.documents[0].id as string;

    const row = await prisma.knowledgeDocument.findUnique({ where: { id } });
    expect(row!.data.length).toBe(0);
    expect(
      bucket.objects.get(knowledgeDocumentStorageKey(acme.company.id, id))?.body,
    ).toEqual(pdf);

    // The background extraction job re-reads the bytes — from the bucket now.
    await drainJobs();
    const extracted = await prisma.knowledgeDocument.findUnique({
      where: { id },
      select: { status: true, _count: { select: { chunks: true } } },
    });
    expect(extracted).toMatchObject({ status: 'READY' });
    expect(extracted!._count.chunks).toBeGreaterThan(0);

    const download = await request(app)
      .get(`/api/v1/knowledge-documents/${id}/download`)
      .set(authHeader(acme.tokens.owner))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c as Buffer));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(download.status).toBe(200);
    expect(Buffer.compare(download.body as Buffer, pdf)).toBe(0);
  });
});

describe('migration skip logic', () => {
  /**
   * The resumability rule of scripts/migrate-storage-to-s3.ts. `dataLength` is
   * the row's current octet_length(data); `sizeBytes` is what was uploaded.
   */
  it('copies rows that still hold bytes', () => {
    expect(decideRow({ sizeBytes: 1024, dataLength: 1024 })).toBe('migrate');
    // A shrunken-but-present column is still unmigrated work.
    expect(decideRow({ sizeBytes: 1024, dataLength: 12 })).toBe('migrate');
  });

  it('skips rows a previous run already finished', () => {
    expect(decideRow({ sizeBytes: 1024, dataLength: 0 })).toBe(
      'already-migrated',
    );
  });

  it('skips zero-byte uploads instead of retrying them forever', () => {
    expect(decideRow({ sizeBytes: 0, dataLength: 0 })).toBe('nothing-to-copy');
  });
});

describe('migration run', () => {
  const options = { dryRun: false, batchSize: 2, only: null };

  /** A Postgres-stored image, i.e. a row as it exists before any migration. */
  async function seedInlineImage(bytes: Buffer): Promise<string> {
    const row = await prisma.storedImage.create({
      data: {
        companyId: acme.company.id,
        fileName: 'legacy.png',
        mimeType: 'image/png',
        sizeBytes: bytes.length,
        data: new Uint8Array(bytes),
      },
    });
    return row.id;
  }

  it('copies inline rows to the bucket, empties them, and is re-runnable', async () => {
    // Seed BEFORE switching modes, so these rows look exactly like production
    // rows written by the old code.
    const first = await seedInlineImage(PNG_1PX);
    const second = await seedInlineImage(Buffer.concat([PNG_1PX, PNG_1PX]));

    const bucket = installFakeS3();
    const run = await migrateTable(SPECS.images, options);

    expect(run).toMatchObject({ migrated: 2, skipped: 0, failed: 0 });
    for (const id of [first, second]) {
      const key = imageStorageKey(acme.company.id, id);
      expect(bucket.objects.has(key)).toBe(true);
      const row = await prisma.storedImage.findUnique({ where: { id } });
      // The emptied column IS the "already migrated" marker.
      expect(row!.data.length).toBe(0);
      expect(row!.sizeBytes).toBeGreaterThan(0);
    }
    expect(Buffer.compare(
      bucket.objects.get(imageStorageKey(acme.company.id, first))!.body,
      PNG_1PX,
    )).toBe(0);

    // Re-running (the interrupted-and-restarted case) must be a no-op: the scan
    // filters emptied rows out in SQL, so nothing is even read back.
    bucket.requests.length = 0;
    const again = await migrateTable(SPECS.images, options);
    expect(again).toMatchObject({ migrated: 0, skipped: 0, failed: 0 });
    expect(bucket.requests).toHaveLength(0);
  });

  it('dry run reports work without uploading or clearing anything', async () => {
    const id = await seedInlineImage(PNG_1PX);
    const bucket = installFakeS3();

    const run = await migrateTable(SPECS.images, { ...options, dryRun: true });

    expect(run).toMatchObject({ migrated: 0, skipped: 1, failed: 0 });
    expect(bucket.requests).toHaveLength(0);
    const row = await prisma.storedImage.findUnique({ where: { id } });
    expect(Buffer.from(row!.data)).toEqual(PNG_1PX);
  });

  it('a failing row is reported and left intact for the next run', async () => {
    const id = await seedInlineImage(PNG_1PX);
    installFakeS3();
    // Upload refused by the bucket: the row must keep its bytes.
    setS3TransportForTesting(() =>
      Promise.resolve({ status: 503, body: Buffer.alloc(0) }),
    );

    const run = await migrateTable(SPECS.images, options);

    expect(run).toMatchObject({ migrated: 0, failed: 1 });
    const row = await prisma.storedImage.findUnique({ where: { id } });
    expect(Buffer.from(row!.data)).toEqual(PNG_1PX);
  });
});
