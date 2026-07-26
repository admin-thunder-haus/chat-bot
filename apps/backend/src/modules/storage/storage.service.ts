import { isS3StorageEnabled } from '../../config/env';
import { logger } from '../../utils/logger';
import { dbStorageProvider } from './db-storage.provider';
import { s3StorageProvider } from './s3-storage.provider';
import type {
  StorageGetInput,
  StoragePutInput,
  StoragePutResult,
  StorageProvider,
} from './storage-provider.interface';

/**
 * Storage seam used by the feature code. Everything that persists uploaded bytes
 * goes through here, so moving files out of Postgres is an env-var change rather
 * than a code change.
 *
 * Provider selection is LAZY and memoised, the same way the rest of the backend
 * resolves optional integrations (billing/stripe.provider.ts, channel-security):
 * env is read at first use rather than at import time, so a test can install a
 * mode before the first call and module import order never decides behaviour.
 */

let cachedProvider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (cachedProvider) return cachedProvider;
  cachedProvider = isS3StorageEnabled() ? s3StorageProvider : dbStorageProvider;
  // Logged once, at INFO: "where are my files?" is the first question when a
  // deployment serves a 404 for an image that exists in the database.
  logger.info('storage.provider.selected', { provider: cachedProvider.name });
  return cachedProvider;
}

/**
 * Force a provider in tests (null re-enables lazy selection). Named after the
 * existing setStripeTransportForTesting / setAIProviderForTesting seams.
 */
export function setStorageProviderForTesting(
  provider: StorageProvider | null,
): void {
  cachedProvider = provider;
}

/**
 * Object keys are DERIVED, never stored: `<kind>/<companyId>/<rowId>`.
 *
 * - Deriving them means no new column, so switching storage needs no schema
 *   migration and no backfill of key strings.
 * - The companyId prefix is a tenancy guard, not decoration: a write for a row
 *   id belonging to another tenant lands under the CALLER's own prefix, so it
 *   can never overwrite another company's object even when a scoped UPDATE later
 *   matches nothing. It also makes per-tenant listing, lifecycle rules and
 *   "delete everything for this company" possible in the bucket.
 */
export function imageStorageKey(companyId: string, imageId: string): string {
  return `images/${companyId}/${imageId}`;
}

export function knowledgeDocumentStorageKey(
  companyId: string,
  documentId: string,
): string {
  return `knowledge-documents/${companyId}/${documentId}`;
}

export const storageService = {
  /** Persist bytes; returns what the owning row's `data` column must contain. */
  put(input: StoragePutInput): Promise<StoragePutResult> {
    return getStorageProvider().put(input);
  },

  /** Read bytes back, given the owning row's `data` column. */
  get(input: StorageGetInput): Promise<Buffer> {
    return getStorageProvider().get(input);
  },

  /** Drop the object behind a key. Safe to call for bytes that never existed. */
  delete(key: string): Promise<void> {
    return getStorageProvider().delete(key);
  },

  /** Provider-side public URL, or null when the provider has none. */
  publicUrl(key: string): string | null {
    return getStorageProvider().publicUrl(key);
  },

  /** Which mode is active — for diagnostics and tests. */
  providerName(): string {
    return getStorageProvider().name;
  },
};
