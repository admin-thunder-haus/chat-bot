import type { StoredImage } from '@prisma/client';
import { prisma } from '../../config/prisma';

/** Data-access for uploaded images. Writes are tenant-scoped by companyId. */
export const imagesRepository = {
  create(input: {
    companyId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    data: Buffer;
  }): Promise<StoredImage> {
    return prisma.storedImage.create({
      // Prisma 6 `Bytes` expects a Uint8Array backed by a plain ArrayBuffer.
      data: { ...input, data: new Uint8Array(input.data) },
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
    return result.count;
  },
};
