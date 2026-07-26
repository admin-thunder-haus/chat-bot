import crypto from 'node:crypto';
import type { StoredImage } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { imageStorageKey, storageService } from '../storage/storage.service';

/** Data-access for uploaded images. Writes are tenant-scoped by companyId. */
export const imagesRepository = {
  /**
   * The single write path for image bytes (uploads AND inbound channel media),
   * which is why the storage seam lives here rather than in the service: callers
   * outside this module hand over a Buffer and must not care where it lands.
   *
   * The row id is generated in application code so the object key is known
   * BEFORE the upload — a database-generated default would force either a
   * second UPDATE or an upload after the row exists (i.e. a window where the row
   * points at nothing).
   */
  async create(input: {
    companyId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    data: Buffer;
  }): Promise<StoredImage> {
    const id = crypto.randomUUID();
    const { inlineData } = await storageService.put({
      key: imageStorageKey(input.companyId, id),
      contentType: input.mimeType,
      data: input.data,
    });

    return prisma.storedImage.create({
      // In DB mode `inlineData` is exactly `new Uint8Array(input.data)` — the
      // same single INSERT of the same bytes this always performed. Prisma 6
      // `Bytes` expects a Uint8Array backed by a plain ArrayBuffer.
      data: { ...input, id, data: inlineData },
    });
  },

  /**
   * Public read by id only — images are served on an unauthenticated URL so
   * channel providers (Meta/Telegram) can fetch them. The UUID itself is the
   * capability; no tenant scoping on read.
   */
  findById(id: string): Promise<StoredImage | null> {
    return prisma.storedImage.findUnique({ where: { id } });
  },

  /** Scoped delete. Returns number of rows removed (0 or 1). */
  async remove(companyId: string, id: string): Promise<number> {
    const result = await prisma.storedImage.deleteMany({
      where: { id, companyId },
    });
    // Only drop the object once the ROW is gone: an orphaned object costs a few
    // KB of bucket, an orphaned row is a broken image. No-op in DB mode.
    if (result.count > 0) {
      await storageService.delete(imageStorageKey(companyId, id));
    }
    return result.count;
  },
};
