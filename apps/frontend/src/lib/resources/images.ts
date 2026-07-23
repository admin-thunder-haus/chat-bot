import { request } from '../api';

export interface UploadedImage {
  id: string;
  /** Absolute public URL — usable directly as a service/product image. */
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export const imagesApi = {
  upload(file: File): Promise<UploadedImage> {
    const form = new FormData();
    form.append('file', file);
    return request<{ image: UploadedImage }>('/images', {
      method: 'POST',
      body: form,
      auth: true,
    }).then((d) => d.image);
  },

  remove(id: string): Promise<null> {
    return request<null>(`/images/${id}`, { method: 'DELETE', auth: true });
  },
};
