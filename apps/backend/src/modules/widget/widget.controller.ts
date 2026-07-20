import type { Request, Response } from 'express';
import { widgetService } from './widget.service';
import { widgetSessionService } from './widget-session.service';
import { AppError } from '../../utils/AppError';
import { sendSuccess } from '../../utils/apiResponse';

/** Extract + verify the widget session from the X-Widget-Session header. */
function requireSession(req: Request) {
  const header = req.headers['x-widget-session'];
  const token = Array.isArray(header) ? header[0] : header;
  const session = widgetSessionService.verify(token);
  if (!session) throw AppError.unauthorized('Missing or invalid widget session');
  return session;
}

export const widgetController = {
  async config(req: Request, res: Response): Promise<void> {
    const config = await widgetService.getPublicConfig(req.params.publicId);
    sendSuccess(res, config, 'Widget config retrieved');
  },

  async startSession(req: Request, res: Response): Promise<void> {
    const result = await widgetService.startSession(
      req.params.publicId,
      req.body,
    );
    sendSuccess(res, result, 'Session started');
  },

  async postMessage(req: Request, res: Response): Promise<void> {
    const session = requireSession(req);
    const result = await widgetService.postMessage(
      req.params.publicId,
      session,
      req.body,
    );
    sendSuccess(res, result, 'Message received', 201);
  },

  async pollMessages(req: Request, res: Response): Promise<void> {
    const session = requireSession(req);
    const result = await widgetService.pollMessages(
      req.params.publicId,
      session,
      typeof req.query.after === 'string' ? req.query.after : undefined,
    );
    sendSuccess(res, result, 'Messages retrieved');
  },

  async typing(req: Request, res: Response): Promise<void> {
    const session = requireSession(req);
    await widgetService.typing(req.params.publicId, session);
    sendSuccess(res, { ok: true }, 'Typing signal received');
  },
};
