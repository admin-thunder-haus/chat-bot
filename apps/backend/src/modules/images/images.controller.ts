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
    // These are intentionally PUBLIC, embeddable assets: the dashboard (its own
    // origin), the Web Chat widget on arbitrary customer sites, and Meta /
    // Telegram fetching attachment URLs. helmet() sets a global
    // Cross-Origin-Resource-Policy: same-origin, which makes browsers block the
    // cross-origin <img>, so the policy is relaxed for THIS route only.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    // Also allow canvas/fetch reads of the same bytes (harmless for public
    // images, and required by the widget when it reads an image programmatically).
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(data);
  },

  async remove(req: Request, res: Response): Promise<void> {
    await imagesService.remove(req.user!.companyId, req.params.imageId);
    sendSuccess(res, null, 'Image deleted successfully');
  },
};
