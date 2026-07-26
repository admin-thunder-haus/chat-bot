import { imagesRepository } from './images.repository';
import { imageStorageKey, storageService } from '../storage/storage.service';
import { AppError } from '../../utils/AppError';

export interface UploadedImageResult {
  id: string;
  /** Absolute public URL — usable directly as a service/product imageUrl. */
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Build the public URL an image is served from.
 *
 * This stays OUR route in every storage mode, deliberately. The value is
 * persisted (Product.imageUrl, Service.imageUrl, Message.mediaUrl) and handed to
 * Meta/Telegram, so it is a long-lived identifier: pointing it at a bucket
 * hostname would mean every stored URL breaks the day the bucket, provider or
 * CDN domain changes. See images.controller.serve for the serving-side reasoning.
 */
export function publicImageUrl(baseUrl: string, imageId: string): string {
  return `${baseUrl.replace(/\/$/, '')}/api/v1/public/images/${imageId}`;
}

export const imagesService = {
  /** Persist an uploaded image and return its public URL. */
  async upload(
    companyId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    baseUrl: string,
  ): Promise<UploadedImageResult> {
    const image = await imagesRepository.create({
      companyId,
      fileName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      data: file.buffer,
    });

    return {
      id: image.id,
      url: publicImageUrl(baseUrl, image.id),
      fileName: image.fileName,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
    };
  },

  /**
   * Load an image for public serving. The row is the source of truth for
   * existence and MIME type in both modes; only the BYTES come from the storage
   * provider (the row itself in DB mode, the bucket in S3 mode).
   */
  async getForServing(
    id: string,
  ): Promise<{ mimeType: string; data: Buffer }> {
    const image = await imagesRepository.findById(id);
    if (!image) throw AppError.notFound('Image not found');
    const data = await storageService.get({
      key: imageStorageKey(image.companyId, image.id),
      inline: image.data,
    });
    return { mimeType: image.mimeType, data };
  },

  async remove(companyId: string, id: string): Promise<void> {
    const count = await imagesRepository.remove(companyId, id);
    if (count === 0) throw AppError.notFound('Image not found');
  },
};
