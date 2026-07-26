import type {
  StorageGetInput,
  StoragePutInput,
  StoragePutResult,
  StorageProvider,
} from './storage-provider.interface';

/**
 * DEFAULT provider: uploaded bytes live in the owning row's `data` column
 * (Postgres `Bytes`), exactly as they have since the feature was written.
 *
 * Every method here is a pure, synchronous translation — no query, no network,
 * no extra statement. That is the point: with no bucket configured the platform
 * must behave BIT-FOR-BIT as it did before this module existed, on every dev
 * machine and in the entire test suite.
 */
export const dbStorageProvider: StorageProvider = {
  name: 'db',

  /**
   * No out-of-band write at all: the bytes are handed straight back so the
   * caller's own INSERT/UPDATE persists them. `new Uint8Array(buffer)` is the
   * same conversion the repositories always applied — Prisma 6 `Bytes` expects a
   * Uint8Array backed by a plain ArrayBuffer.
   */
  put(input: StoragePutInput): Promise<StoragePutResult> {
    return Promise.resolve({ inlineData: new Uint8Array(input.data) });
  },

  /** The row already carries the bytes; `key` is irrelevant here. */
  get(input: StorageGetInput): Promise<Buffer> {
    return Promise.resolve(Buffer.from(input.inline));
  },

  /**
   * Nothing to do: the bytes are a column of the row being deleted (and of the
   * company that cascades), so they are already gone.
   */
  delete(): Promise<void> {
    return Promise.resolve();
  },

  /** Postgres-stored bytes are only reachable through our own serving route. */
  publicUrl(): string | null {
    return null;
  },
};
