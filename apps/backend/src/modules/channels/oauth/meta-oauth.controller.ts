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

  /**
   * Two possible outcomes, deliberately distinguished by status code so the
   * client cannot mistake "choose one" for "done": 201 when a single asset was
   * unambiguous and is now connected, 200 with a selection when the operator
   * still has to pick.
   */
  async completeWhatsApp(req: Request, res: Response): Promise<void> {
    const result = await metaOauthService.completeWhatsApp(
      req.user!.companyId,
      req.user!.id,
      req.body as { code: string; phoneNumberId?: string; wabaId?: string },
    );
    if ('account' in result) {
      sendSuccess(res, result, 'WhatsApp connected successfully', 201);
      return;
    }
    sendSuccess(
      res,
      { ...result, requiresSelection: true },
      'Choose which WhatsApp number to connect',
    );
  },

  async getSelection(req: Request, res: Response): Promise<void> {
    const selection = await metaOauthService.getSelection(
      req.user!.companyId,
      req.params.selectionId,
    );
    sendSuccess(res, { selection }, 'Selection retrieved successfully');
  },

  async connectSelection(req: Request, res: Response): Promise<void> {
    const account = await metaOauthService.connectSelected(
      req.user!.companyId,
      req.user!.id,
      req.params.selectionId,
      req.body as { pageId?: string; wabaId?: string; phoneNumberId?: string },
    );
    sendSuccess(res, { account }, 'Channel connected successfully', 201);
  },
};
