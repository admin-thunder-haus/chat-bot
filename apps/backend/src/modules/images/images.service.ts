import { imagesRepository } from './images.repository';
import { AppError } from '../../utils/AppError';

export interface UploadedImageResult {
  id: string;
  /** Absolute public URL — usable directly as a service/product imageUrl. */
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

/** Build the public URL an image is served from. */
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

  /** Load an image for public serving. */
  async getForServing(
    id: string,
  ): Promise<{ mimeType: string; data: Buffer }> {
    const image = await imagesRepository.findById(id);
    if (!image) throw AppError.notFound('Image not found');
    return { mimeType: image.mimeType, data: Buffer.from(image.data) };
  },

  async remove(companyId: string, id: string): Promise<void> {
    const count = await imagesRepository.remove(companyId, id);
    if (count === 0) throw AppError.notFound('Image not found');
  },
};
