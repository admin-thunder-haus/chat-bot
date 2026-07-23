/**
 * Small injectable binary downloader used by channel providers to fetch inbound
 * media (voice notes) from provider CDNs. Mirrors the providers' JSON transport
 * pattern: global `fetch` with a bounded timeout by default, and a test hook so
 * the suite never hits the network. Oversized bodies are treated as failures.
 */

/** Hard upper bound on any inbound media download (25 MB). */
export const MAX_BINARY_FETCH_BYTES = 25 * 1024 * 1024;

export interface BinaryFetchInput {
  url: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  /** Caller-provided cap; always clamped to {@link MAX_BINARY_FETCH_BYTES}. */
  maxBytes: number;
}

export interface BinaryFetchResult {
  ok: boolean;
  status: number;
  buffer: Buffer | null;
  /** Bare mime type from Content-Type (no parameters), or null when absent. */
  mimeType: string | null;
}

export type BinaryFetcher = (
  input: BinaryFetchInput,
) => Promise<BinaryFetchResult>;

const defaultFetcher: BinaryFetcher = async (input) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const res = await fetch(input.url, {
      method: 'GET',
      headers: input.headers ?? {},
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, status: res.status, buffer: null, mimeType: null };
    }
    const maxBytes = Math.min(input.maxBytes, MAX_BINARY_FETCH_BYTES);
    const body = await res.arrayBuffer();
    if (body.byteLength > maxBytes) {
      // Too large to store — treated as a failed download, never a crash.
      return { ok: false, status: res.status, buffer: null, mimeType: null };
    }
    const contentType = (res.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim();
    return {
      ok: true,
      status: res.status,
      buffer: Buffer.from(body),
      mimeType: contentType || null,
    };
  } catch {
    // Timeout / abort / network — a failed download, never a crash.
    return { ok: false, status: 0, buffer: null, mimeType: null };
  } finally {
    clearTimeout(timer);
  }
};

let fetcher: BinaryFetcher = defaultFetcher;

/** Test hook: inject a fake binary fetcher (null restores the real one). */
export function setBinaryFetcherForTesting(fn: BinaryFetcher | null): void {
  fetcher = fn ?? defaultFetcher;
}

/** Download a binary resource. Never throws — failures return `ok: false`. */
export function fetchBinary(input: BinaryFetchInput): Promise<BinaryFetchResult> {
  return fetcher(input);
}
