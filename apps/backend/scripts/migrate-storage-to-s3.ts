/**
 * One-off, HAND-RUN migration: copy uploaded bytes that still live inside
 * Postgres (`stored_images.data`, `knowledge_documents.data`) into the
 * configured S3-compatible bucket.
 *
 *   npx tsx scripts/migrate-storage-to-s3.ts --dry-run
 *   npx tsx scripts/migrate-storage-to-s3.ts --batch=50
 *   npx tsx scripts/migrate-storage-to-s3.ts --only=images
 *
 * WHY there is nothing to "rewrite": object keys are DERIVED from
 * (kind, companyId, rowId) — see modules/storage/storage.service.ts — and the
 * public image URL stays our own /api/v1/public/images/<id> route in both modes.
 * So no row stores a key or a bucket URL, no URL a customer or Meta already has
 * ever changes, and this migration needs no schema change and no URL rewrite.
 * It moves bytes and nothing else.
 *
 * RESUMABLE — how a finished row is recognised: a row is DONE when its `data`
 * column is empty (`octet_length(data) = 0`) while `sizeBytes` says the file had
 * content. Clearing the column is the last step for each row and only happens
 * after the uploaded object has been read back and verified, so "empty column"
 * cannot mean "half migrated". The scan filters those rows out in SQL, which is
 * also why re-running after an interruption costs nothing: it never even reads
 * the bytes of a row it is going to skip.
 *
 * Config comes from the environment like the rest of the backend. Secrets are
 * never printed — only the bucket name and the endpoint HOST are logged.
 */

import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { isS3StorageEnabled, s3StorageConfig } from '../src/config/env';
import { prisma } from '../src/config/prisma';
import { s3StorageProvider } from '../src/modules/storage/s3-storage.provider';
import {
  imageStorageKey,
  knowledgeDocumentStorageKey,
} from '../src/modules/storage/storage.service';

/** Every uuid sorts above this, so it seeds the keyset cursor. */
const UUID_ZERO = '00000000-0000-0000-0000-000000000000';
const EMPTY_BYTES = new Uint8Array(0);

/**
 * Progress goes to stdout as PLAIN LINES, not through utils/logger: this is a
 * hand-run tool whose output a person reads while it works, and JSON log entries
 * are the wrong shape for that. Silenced under tests for the same reason the
 * logger is — the suite drives these functions directly and its output must stay
 * readable.
 */
const quiet = process.env.NODE_ENV === 'test';

function out(line: string): void {
  if (!quiet) console.log(line);
}

function fail(line: string): void {
  if (!quiet) console.error(line);
}

export type RowDecision =
  /** Bytes are still in Postgres: copy them. */
  | 'migrate'
  /** Column already emptied by a previous run: skip. */
  | 'already-migrated'
  /**
   * Zero-byte upload: there is nothing to copy, and never will be. Such a row
   * is already broken (it serves no image), and after the switch it answers 404
   * instead of an empty 200 — the only behaviour difference the move produces.
   */
  | 'nothing-to-copy';

/**
 * The resumability rule, extracted so it can be tested without a CLI, a bucket
 * or a database. `dataLength` is the CURRENT size of the row's `data` column
 * (octet_length), `sizeBytes` the size recorded at upload time.
 */
export function decideRow(row: {
  sizeBytes: number;
  dataLength: number;
}): RowDecision {
  if (row.dataLength > 0) return 'migrate';
  return row.sizeBytes > 0 ? 'already-migrated' : 'nothing-to-copy';
}

interface ScanRow {
  id: string;
  companyId: string;
  sizeBytes: number;
  dataLength: number;
}

export interface TableSpec {
  label: string;
  /** Physical table name (@@map value). */
  table: string;
  storageKey: (companyId: string, id: string) => string;
}

/** Exported so tests can drive one table's migration without the CLI. */
export const SPECS: Record<'images' | 'documents', TableSpec> = {
  images: {
    label: 'images',
    table: 'stored_images',
    storageKey: imageStorageKey,
  },
  documents: {
    label: 'knowledge documents',
    table: 'knowledge_documents',
    storageKey: knowledgeDocumentStorageKey,
  },
};

export interface Options {
  dryRun: boolean;
  batchSize: number;
  only: 'images' | 'documents' | null;
}

export interface Stats {
  migrated: number;
  skipped: number;
  failed: number;
  bytes: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { dryRun: false, batchSize: 25, only: null };
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--batch=')) {
      const value = Number(arg.slice('--batch='.length));
      if (!Number.isInteger(value) || value < 1 || value > 500) {
        throw new Error('--batch must be an integer between 1 and 500');
      }
      options.batchSize = value;
    } else if (arg === '--only=images') options.only = 'images';
    else if (arg === '--only=documents') options.only = 'documents';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

/**
 * Next batch of candidate rows. `octet_length(data)` is read INSTEAD of the
 * bytes: a batch of ten 10 MB PDFs would otherwise cross the wire just to
 * discover the rows were already done. The keyset cursor (`id > last`) keeps the
 * scan O(batch) no matter how far into a large table the run has got.
 */
function scanBatch(
  spec: TableSpec,
  afterId: string,
  limit: number,
): Promise<ScanRow[]> {
  return prisma.$queryRaw<ScanRow[]>`
    SELECT id::text AS id,
           "companyId"::text AS "companyId",
           "sizeBytes" AS "sizeBytes",
           octet_length(data) AS "dataLength"
    FROM ${Prisma.raw(`"${spec.table}"`)}
    WHERE id > ${afterId}::uuid
      AND octet_length(data) > 0
    ORDER BY id
    LIMIT ${limit}
  `;
}

/** The bytes of one row, fetched only when it is actually going to be copied. */
async function loadBytes(
  spec: TableSpec,
  id: string,
): Promise<{ data: Buffer; mimeType: string } | null> {
  const rows = await prisma.$queryRaw<{ data: Buffer; mimeType: string }[]>`
    SELECT data, "mimeType" AS "mimeType"
    FROM ${Prisma.raw(`"${spec.table}"`)}
    WHERE id = ${id}::uuid
  `;
  return rows[0] ?? null;
}

/**
 * Clear the row's inline bytes with raw SQL rather than prisma.update: the model
 * has an `@updatedAt` column, and an infrastructure migration must not make
 * every document look edited today.
 */
async function clearInlineBytes(spec: TableSpec, id: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE ${Prisma.raw(`"${spec.table}"`)}
    SET data = ''::bytea
    WHERE id = ${id}::uuid
  `;
}

async function migrateOne(
  spec: TableSpec,
  row: ScanRow,
  options: Options,
): Promise<'migrated' | 'skipped' | 'failed'> {
  const key = spec.storageKey(row.companyId, row.id);
  const decision = decideRow(row);
  if (decision !== 'migrate') {
    out(`  skip ${key} (${decision})`);
    return 'skipped';
  }

  if (options.dryRun) {
    out(`  would copy ${key} (${row.dataLength} bytes)`);
    return 'skipped';
  }

  try {
    const loaded = await loadBytes(spec, row.id);
    if (!loaded) {
      // Deleted between the scan and now — nothing to migrate, not a failure.
      out(`  skip ${key} (row disappeared)`);
      return 'skipped';
    }

    await s3StorageProvider.put({
      key,
      contentType: loaded.mimeType,
      data: loaded.data,
    });

    // Read the object back BEFORE dropping the only other copy. A 2xx on the
    // upload is not proof that the bytes are retrievable (wrong bucket, a proxy
    // that swallowed the body); the digest comparison is.
    const readBack = await s3StorageProvider.get({ key, inline: EMPTY_BYTES });
    const expected = crypto.createHash('sha256').update(loaded.data).digest('hex');
    const actual = crypto.createHash('sha256').update(readBack).digest('hex');
    if (expected !== actual) {
      throw new Error(
        `verification failed: uploaded ${loaded.data.length} bytes, read back ${readBack.length}`,
      );
    }

    await clearInlineBytes(spec, row.id);
    out(`  copied ${key} (${loaded.data.length} bytes)`);
    return 'migrated';
  } catch (err) {
    // Per-row isolation: one unreadable file, one transient 500 from the bucket,
    // must not abandon the rest of the table. The row keeps its inline bytes, so
    // the next run picks it up again.
    fail(
      `  FAILED ${key}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 'failed';
  }
}

/**
 * Migrate one table, batch by batch. Exported so the raw SQL and the
 * skip-already-migrated loop are covered by tests instead of only by a hand run.
 */
export async function migrateTable(
  spec: TableSpec,
  options: Options,
): Promise<Stats> {
  const stats: Stats = { migrated: 0, skipped: 0, failed: 0, bytes: 0 };
  let cursor = UUID_ZERO;
  let batchNumber = 0;

  for (;;) {
    const batch = await scanBatch(spec, cursor, options.batchSize);
    if (batch.length === 0) break;
    batchNumber += 1;
    out(
      `[${spec.label}] batch ${batchNumber}: ${batch.length} row(s) with inline bytes`,
    );

    for (const row of batch) {
      const outcome = await migrateOne(spec, row, options);
      stats[outcome] += 1;
      if (outcome === 'migrated') stats.bytes += row.dataLength;
    }

    // The cursor advances even past failures, so a permanently broken row cannot
    // turn the run into an infinite loop (it is reported and retried next time).
    cursor = batch[batch.length - 1].id;
  }

  out(
    `[${spec.label}] done: ${stats.migrated} migrated, ${stats.skipped} skipped, ${stats.failed} failed, ${stats.bytes} bytes copied`,
  );
  return stats;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const config = s3StorageConfig();
  if (!config || !isS3StorageEnabled()) {
    fail(
      [
        '',
        'Object storage is NOT configured, so there is nowhere to migrate to.',
        'Set all of these before running this script:',
        '  S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,',
        '  S3_PUBLIC_BASE_URL   (and S3_REGION — must be "auto" for Cloudflare R2)',
        '',
        'With them unset the platform keeps storing files in Postgres, which is',
        'a supported mode — nothing is broken, this script simply has no target.',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  // Bucket + endpoint host only. Credentials are never printed.
  out(
    `Migrating Postgres-stored files into bucket "${config.bucket}" at ${new URL(config.endpoint).host} (region ${config.region})`,
  );
  if (options.dryRun) out('DRY RUN — nothing will be uploaded or cleared');

  const specs = options.only
    ? [SPECS[options.only]]
    : [SPECS.images, SPECS.documents];

  let failed = 0;
  for (const spec of specs) {
    const stats = await migrateTable(spec, options);
    failed += stats.failed;
  }

  await prisma.$disconnect();
  if (failed > 0) {
    fail(
      `\n${failed} row(s) failed. They still hold their bytes in Postgres — re-run to retry only those.`,
    );
    process.exit(1);
  }
  out('\nAll done.');
}

// Only run when invoked directly, so the helpers above can be imported by tests.
if (require.main === module) {
  void main().catch(async (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    await prisma.$disconnect();
    process.exit(1);
  });
}
