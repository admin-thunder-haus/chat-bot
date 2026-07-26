/**
 * Generic file-storage abstraction for uploaded BYTES (images, voice notes,
 * knowledge PDFs).
 *
 * The shape is deliberately NOT a generic S3 SDK surface. It is modelled on what
 * the two call sites actually do, which is why `put` returns an inline payload
 * and `get` accepts one:
 *
 *  - Both owners (StoredImage, KnowledgeDocument) are rows whose `data` column
 *    holds the bytes TODAY. The default provider must keep writing them in the
 *    SAME single INSERT/UPDATE the code already performs — no second write, no
 *    behaviour change, no new failure mode. So `put` does not "store and forget";
 *    it returns what the owning row's `data` column must contain, and the caller
 *    keeps its one statement.
 *  - `get` receives that same column back. This is what makes switching modes
 *    safe on a live database: with a bucket configured, rows that have not been
 *    migrated yet STILL carry their bytes inline, and the S3 provider serves
 *    those from the row instead of 404-ing on a key that was never uploaded.
 *    Migration therefore becomes optional and interruptible rather than a
 *    flag-day cutover.
 *
 * Keys are DERIVED from (kind, companyId, rowId) — never stored in a column —
 * because adding a column would mean a schema migration for what is otherwise a
 * pure infrastructure swap. See storage.service.ts for the key helpers.
 */

export interface StoragePutInput {
  /** Derived object key, e.g. `images/<companyId>/<imageId>`. */
  key: string;
  /** MIME type to serve the object back with. */
  contentType: string;
  data: Buffer;
}

/**
 * Prisma 6 `Bytes` accepts only a Uint8Array backed by a PLAIN ArrayBuffer (a
 * SharedArrayBuffer-backed view is rejected at the type level), which is what
 * the generic argument pins down here.
 */
export type InlineBytes = Uint8Array<ArrayBuffer>;

export interface StoragePutResult {
  /**
   * What the owning row's `data` column must be set to. The DB provider returns
   * the bytes themselves; an out-of-band provider returns an EMPTY array, which
   * doubles as the "these bytes live elsewhere" marker (see storage.service.ts).
   */
  inlineData: InlineBytes;
}

export interface StorageGetInput {
  key: string;
  /** The owning row's `data` column exactly as read from Postgres. */
  inline: Uint8Array;
}

export interface StorageProvider {
  /** Stable identifier used in logs and asserted by tests ('db' | 's3'). */
  readonly name: string;

  put(input: StoragePutInput): Promise<StoragePutResult>;

  /** Resolve the bytes for a key. Throws if they cannot be read. */
  get(input: StorageGetInput): Promise<Buffer>;

  /**
   * Drop the object for a key. Called AFTER the owning row is deleted, so it
   * must tolerate an object that is already gone (delete is idempotent).
   */
  delete(key: string): Promise<void>;

  /**
   * Direct, provider-side public URL for an object, or null when the provider
   * has none (the DB provider has no URL of its own — the bytes are only
   * reachable through our own serving route).
   *
   * NOTE: this is intentionally NOT what images.service.publicImageUrl returns.
   * The URL embedded in messages and stored in Product/Service.imageUrl stays
   * our own route in BOTH modes — see images.controller.serve for why.
   */
  publicUrl(key: string): string | null;
}
