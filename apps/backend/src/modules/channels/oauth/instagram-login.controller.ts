import type { Request, Response } from 'express';
import { instagramLoginService } from './instagram-login.service';
import { sendSuccess } from '../../../utils/apiResponse';

/** Public backend origin — trust proxy is enabled in app.ts, so this is the
 * externally visible protocol + host (what Instagram must redirect back to). */
function publicBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}`;
}

export const instagramLoginController = {
  async status(_req: Request, res: Response): Promise<void> {
    sendSuccess(
      res,
      instagramLoginService.getStatus(),
      'Instagram Login status retrieved successfully',
    );
  },

  async start(req: Request, res: Response): Promise<void> {
    const { url } = instagramLoginService.startFlow(
      req.user!.companyId,
      req.user!.id,
      publicBaseUrl(req),
    );
    sendSuccess(res, { url }, 'Instagram Login flow started');
  },

  /** PUBLIC redirect target — always answers with a 302 to the dashboard. */
  async callback(req: Request, res: Response): Promise<void> {
    const redirectUrl = await instagramLoginService.handleCallback(
      req.query as Record<string, unknown>,
      publicBaseUrl(req),
    );
    res.redirect(302, redirectUrl);
  },
};
