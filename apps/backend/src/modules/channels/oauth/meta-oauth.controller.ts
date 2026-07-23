import type { Request, Response } from 'express';
import { metaOauthService, type MetaOauthProvider } from './meta-oauth.service';
import { sendSuccess } from '../../../utils/apiResponse';

/** Public backend origin — trust proxy is enabled in app.ts, so this is the
 * externally visible protocol + host (what Meta must redirect back to). */
function publicBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}`;
}

export const metaOauthController = {
  async status(_req: Request, res: Response): Promise<void> {
    sendSuccess(
      res,
      metaOauthService.getStatus(),
      'Meta OAuth status retrieved successfully',
    );
  },

  async start(req: Request, res: Response): Promise<void> {
    const { provider } = req.body as { provider: MetaOauthProvider };
    const { url } = metaOauthService.startFlow(
      req.user!.companyId,
      req.user!.id,
      provider,
      publicBaseUrl(req),
    );
    sendSuccess(res, { url }, 'Meta OAuth flow started');
  },

  /** PUBLIC redirect target — always answers with a 302 to the dashboard. */
  async callback(req: Request, res: Response): Promise<void> {
    const redirectUrl = await metaOauthService.handleCallback(
      req.query as Record<string, unknown>,
      publicBaseUrl(req),
    );
    res.redirect(302, redirectUrl);
  },

  async completeWhatsApp(req: Request, res: Response): Promise<void> {
    const account = await metaOauthService.completeWhatsApp(
      req.user!.companyId,
      req.user!.id,
      req.body as { code: string; phoneNumberId?: string; wabaId?: string },
    );
    sendSuccess(res, { account }, 'WhatsApp connected successfully', 201);
  },
};
