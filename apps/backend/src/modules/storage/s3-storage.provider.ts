import { s3StorageConfig, type S3StorageConfig } from '../../config/env';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import { signS3Request } from './s3-signature';
import type {
  StorageGetInput,
  StoragePutInput,
  StoragePutResult,
  StorageProvider,
} from './storage-provider.interface';

/**
 * S3-compatible object storage (Cloudflare R2 / AWS S3) over the RAW REST API —
 * no AWS SDK, mirroring billing/stripe.provider.ts. Requests are SigV4-signed by
 * s3-signature.ts and the HTTP transport is INJECTABLE so tests never touch a
 * real bucket.
 *
 * Addressing is PATH-STYLE (`{endpoint}/{bucket}/{key}`): R2 only supports path
 * style, and AWS S3 still accepts it, so one code path serves both.
 */

export interface S3TransportResponse {
  status: number;
  body: Buffer;
}

export type S3Transport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: Buffer },
) => Promise<S3TransportResponse>;

let transportOverride: S3Transport | null = null;

/** Inject a fake S3 HTTP transport in tests (null restores the default). */
export function setS3TransportForTesting(transport: S3Transport | null): void {
  transportOverride = transport;
}

const defaultTransport: S3Transport = async (url, init) => {
  const res = await fetch(url, init);
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, body };
};

/**
 * Object storage must be configured before any of these methods run — the
 * selector only ever hands this provider out when s3StorageConfig() is non-null,
 * so reaching here without config is a programming error, not a user error.
 */
function requireConfig(): S3StorageConfig {
  const config = s3StorageConfig();
  if (!config) {
    throw AppError.internal('Object storage is not configured');
  }
  return config;
}

function objectUrl(config: S3StorageConfig, key: string): string {
  return `${config.endpoint}/${config.bucket}/${key}`;
}

async function send(
  method: string,
  key: string,
  options: { body?: Buffer; contentType?: string } = {},
): Promise<S3TransportResponse> {
  const config = requireConfig();
  // Only Content-Type is signed alongside the mandatory x-amz-* headers.
  // Content-Length is deliberately NOT signed: the HTTP layer (undici) sets it
  // from the body itself, and a value it rewrote would invalidate the signature
  // with an opaque 403 that no test could see coming.
  const headers: Record<string, string> = {};
  if (options.contentType) headers['Content-Type'] = options.contentType;

  const signed = signS3Request({
    method,
    url: objectUrl(config, key),
    body: options.body,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    headers,
  });

  const transport = transportOverride ?? defaultTransport;
  return transport(signed.url, {
    method,
    headers: signed.headers,
    body: options.body,
  });
}

/**
 * Log a failure WITHOUT the response body: an S3 error document echoes the
 * request (including the signed headers we sent), so it must never reach the
 * log. The key is safe — it is derived from ids the log already carries.
 */
function failed(operation: string, key: string, status: number): AppError {
  logger.error('storage.s3.request.failed', { operation, key, status });
  return AppError.internal('File storage request failed');
}

export const s3StorageProvider: StorageProvider = {
  name: 's3',

  /**
   * Upload the object, then tell the caller to store an EMPTY `data` column.
   * Upload FIRST, on purpose: if the PUT fails the row is never written, so the
   * database never points at bytes that do not exist. The reverse order would
   * produce silently unreadable images.
   */
  async put(input: StoragePutInput): Promise<StoragePutResult> {
    const res = await send('PUT', input.key, {
      body: input.data,
      contentType: input.contentType,
    });
    if (res.status >= 300) throw failed('put', input.key, res.status);
    return { inlineData: new Uint8Array(0) };
  },

  /**
   * Prefer the row's inline bytes when it still has them. This is what makes the
   * cutover non-atomic-safe: flipping the env vars on a database full of
   * Postgres-stored files keeps every existing file readable, and the migration
   * script can then move them at its own pace (or never).
   */
  async get(input: StorageGetInput): Promise<Buffer> {
    if (input.inline.length > 0) return Buffer.from(input.inline);

    const res = await send('GET', input.key);
    if (res.status === 404) throw AppError.notFound('File not found');
    if (res.status >= 300) throw failed('get', input.key, res.status);
    return res.body;
  },

  /** Idempotent: S3 answers 204 whether or not the object existed. */
  async delete(key: string): Promise<void> {
    const res = await send('DELETE', key);
    // 404 is success here — the object is gone, which is all the caller wanted.
    if (res.status >= 300 && res.status !== 404) {
      throw failed('delete', key, res.status);
    }
  },

  publicUrl(key: string): string | null {
    return `${requireConfig().publicBaseUrl}/${key}`;
  },
};
