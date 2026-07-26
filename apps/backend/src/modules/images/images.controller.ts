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

  /**
   * Public, unauthenticated: providers fetch attachment URLs directly.
   *
   * With object storage configured this route PROXIES the bytes rather than
   * redirecting to the bucket's public URL. Both work; proxying was chosen
   * because:
   *  1. The URL is durable — it is already stored in Product/Service.imageUrl
   *     and Message.mediaUrl rows and already delivered to Meta/Telegram, so it
   *     must keep resolving even if the bucket or CDN domain changes later.
   *  2. The response headers below stay OURS. A redirect hands the final
   *     response — the one the browser actually judges — to the bucket, which
   *     typically sets neither of the two headers this route exists to set. That
   *     failure mode is invisible to curl and to server-side fetches and shows up
   *     only as a blocked image in a real browser.
   *  3. The bucket can stay private: the UUID remains the only capability, and
   *     no object is world-readable just because it was uploaded.
   * The cost is Render egress for image traffic; if that ever matters, the switch
   * is a 302 to storageService.publicUrl(key) for NEW ids only, keeping this
   * proxy for everything already published.
   */
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
