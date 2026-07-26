import {
  s3StorageProvider,
  setS3TransportForTesting,
  type S3Transport,
  type S3TransportResponse,
} from '../src/modules/storage/s3-storage.provider';
import { setStorageProviderForTesting } from '../src/modules/storage/storage.service';

/**
 * In-memory stand-in for an S3-compatible bucket.
 *
 * Storage mode is env-driven, so a test that wants S3 mode has to (a) set the
 * env vars, (b) force the memoised provider, and (c) inject a transport. Doing
 * all three in one helper is what keeps the DEFAULT — bytes in Postgres — intact
 * for every other suite: nothing here leaks unless uninstallFakeS3() is skipped.
 *
 * The values below are obviously fake on purpose; a real key must never be
 * needed to run the suite, and global fetch is replaced with a thrower while the
 * fake is installed so an accidental real request fails loudly instead of
 * silently reaching a bucket.
 */

const FAKE_ENV: Record<string, string> = {
  S3_ENDPOINT: 'https://fake-account.r2.example.invalid',
  S3_BUCKET: 'test-bucket',
  S3_ACCESS_KEY_ID: 'test-access-key-id',
  S3_SECRET_ACCESS_KEY: 'test-secret-access-key',
  S3_PUBLIC_BASE_URL: 'https://files.example.invalid',
  S3_REGION: 'auto',
};

export interface FakeS3Request {
  method: string;
  url: string;
  key: string;
  headers: Record<string, string>;
  bodyLength: number;
}

export interface FakeS3Bucket {
  objects: Map<string, { body: Buffer; contentType: string | undefined }>;
  requests: FakeS3Request[];
}

let savedFetch: typeof globalThis.fetch | null = null;

/** Object key from a path-style URL: /<bucket>/<key...>. */
function keyFromUrl(url: string): string {
  const { pathname } = new URL(url);
  return pathname.replace(`/${FAKE_ENV.S3_BUCKET}/`, '');
}

export function installFakeS3(): FakeS3Bucket {
  for (const [name, value] of Object.entries(FAKE_ENV)) {
    process.env[name] = value;
  }

  const bucket: FakeS3Bucket = { objects: new Map(), requests: [] };

  const transport: S3Transport = (url, init) => {
    const key = keyFromUrl(url);
    bucket.requests.push({
      method: init.method,
      url,
      key,
      headers: init.headers,
      bodyLength: init.body?.length ?? 0,
    });

    let response: S3TransportResponse;
    if (init.method === 'PUT') {
      bucket.objects.set(key, {
        body: Buffer.from(init.body ?? Buffer.alloc(0)),
        contentType: init.headers['Content-Type'],
      });
      response = { status: 200, body: Buffer.alloc(0) };
    } else if (init.method === 'GET') {
      const found = bucket.objects.get(key);
      response = found
        ? { status: 200, body: found.body }
        : { status: 404, body: Buffer.from('<Error>NoSuchKey</Error>') };
    } else if (init.method === 'DELETE') {
      bucket.objects.delete(key);
      response = { status: 204, body: Buffer.alloc(0) };
    } else {
      response = { status: 405, body: Buffer.alloc(0) };
    }
    return Promise.resolve(response);
  };

  setS3TransportForTesting(transport);
  setStorageProviderForTesting(s3StorageProvider);

  savedFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error('storage test attempted a real network request');
  }) as unknown as typeof globalThis.fetch;

  return bucket;
}

/** Restore the default (Postgres) storage mode and the real fetch. */
export function uninstallFakeS3(): void {
  for (const name of Object.keys(FAKE_ENV)) delete process.env[name];
  setS3TransportForTesting(null);
  setStorageProviderForTesting(null);
  if (savedFetch) {
    globalThis.fetch = savedFetch;
    savedFetch = null;
  }
}
