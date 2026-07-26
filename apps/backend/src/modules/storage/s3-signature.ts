import crypto from 'node:crypto';

/**
 * AWS Signature Version 4 signing for S3-compatible object storage, done by hand
 * with node:crypto.
 *
 * WHY no AWS SDK: the same reasoning as billing/stripe.provider.ts — this
 * backend talks to third parties over raw REST so a single optional feature
 * cannot drag a large dependency tree (and its transitive CVE surface) into
 * every install and every cold start. Object PUT/GET/DELETE need exactly one
 * signed header; that is ~80 lines, all of it below.
 *
 * Both Cloudflare R2 and AWS S3 accept SigV4 with the `s3` service name, which
 * is why one implementation covers both. R2 requires region 'auto'.
 *
 * Kept in its own file (rather than inside the provider) because it is pure and
 * deterministic: given a fixed clock it always produces the same signature, so
 * it can be unit-tested against the published AWS test vectors.
 */

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';

export interface SignS3RequestInput {
  method: string;
  /** Absolute request URL, including the bucket and key path. */
  url: string;
  /** Request body, if any. Empty/absent bodies hash to the SHA-256 of "". */
  body?: Buffer;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * Extra headers that must be covered by the signature (e.g. `content-type`).
   * `host`, `x-amz-date` and `x-amz-content-sha256` are always added here.
   */
  headers?: Record<string, string>;
  /** Injectable clock: tests need a fixed timestamp to assert a signature. */
  now?: Date;
}

export interface SignedS3Request {
  url: string;
  /** Every header the request must be sent with, Authorization included. */
  headers: Record<string, string>;
}

export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

/**
 * RFC 3986 encoding. encodeURIComponent leaves !'()* alone but SigV4 requires
 * them percent-encoded, and a single mismatched byte here is an opaque 403.
 */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Canonical URI: each path SEGMENT is encoded, the separators are not. S3 signs
 * the path single-encoded (unlike most other AWS services).
 */
function canonicalUri(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => encodeRfc3986(decodeURIComponent(segment)))
    .join('/');
}

/** Canonical query string: encoded, sorted by name then value. */
function canonicalQuery(url: URL): string {
  const pairs: [string, string][] = [];
  url.searchParams.forEach((value, name) => {
    pairs.push([encodeRfc3986(name), encodeRfc3986(value)]);
  });
  pairs.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  return pairs.map(([name, value]) => `${name}=${value}`).join('&');
}

/**
 * Derived signing key: HMAC chain over date → region → service → terminator.
 * Deliberately NOT cached — it is four HMACs, and caching it would mean holding
 * key material in a module-level variable for the lifetime of the process.
 */
function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  return hmac(
    hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), SERVICE),
    'aws4_request',
  );
}

/** Sign one request; returns the headers it must be sent with. */
export function signS3Request(input: SignS3RequestInput): SignedS3Request {
  const url = new URL(input.url);
  const now = input.now ?? new Date();
  // 20260726T101530Z / 20260726 — the only timestamp format SigV4 accepts.
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = sha256Hex(input.body ?? Buffer.alloc(0));

  // Lower-cased header names: the canonical request is case-sensitive even
  // though HTTP is not.
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    headers[name.toLowerCase()] = value.trim();
  }
  headers['host'] = url.host;
  headers['x-amz-content-sha256'] = payloadHash;
  headers['x-amz-date'] = amzDate;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${headers[name]}\n`)
    .join('');
  const signedHeaders = signedHeaderNames.join(';');

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri(url.pathname),
    canonicalQuery(url),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${input.region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signature = hmac(
    signingKey(input.secretAccessKey, dateStamp, input.region),
    stringToSign,
  ).toString('hex');

  return {
    url: input.url,
    headers: {
      ...input.headers,
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization:
        `${ALGORITHM} Credential=${input.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}
