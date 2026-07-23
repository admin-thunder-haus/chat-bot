import type { Request, Response } from 'express';
import { imagesService } from './images.service';
import { sendSuccess } from '../../utils/apiResponse';

export const imagesController = {
  async upload(req: Request, res: Response): Promise<void> {
    // trust proxy is enabled, so protocol/host reflect the public origin
    // (needed on Render, where the app sits behind a TLS proxy).
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const image = await imagesService.upload(
      req.user!.companyId,
      req.file!,
      baseUrl,
    );
    sendSuccess(res, { image }, 'Image uploaded successfully', 201);
  },

  /** Public, unauthenticated: providers fetch attachment URLs directly. */
  async serve(req: Request, res: Response): Promise<void> {
    const { mimeType, data } = await imagesService.getForServing(
      req.params.imageId,
    );
    res.setHeader('Content-Type', mimeType);
    // Uploaded images are immutable (re-upload = new id), so cache hard.
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.send(data);
  },

  async remove(req: Request, res: Response): Promise<void> {
    await imagesService.remove(req.user!.companyId, req.params.imageId);
    sendSuccess(res, null, 'Image deleted successfully');
  },
};
