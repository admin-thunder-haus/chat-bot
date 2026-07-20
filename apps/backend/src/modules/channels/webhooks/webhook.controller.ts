import type { Request, Response } from 'express';
import { webhookService } from './webhook.service';
import { sendSuccess } from '../../../utils/apiResponse';

function headerMap(req: Request): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    out[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

function queryMap(req: Request): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.query)) {
    out[k] = typeof v === 'string' ? v : Array.isArray(v) ? String(v[0]) : undefined;
  }
  return out;
}

export const webhookController = {
  /** GET: verification challenge. Echoes the challenge as plain text on success. */
  async verify(req: Request, res: Response): Promise<void> {
    const outcome = await webhookService.verify(
      req.params.providerKey,
      req.params.channelAccountId,
      queryMap(req),
      headerMap(req),
    );
    // Providers (e.g. Meta) expect the raw challenge echoed back as the body.
    res.status(200).type('text/plain').send(outcome.challenge);
  },

  /** POST: event ingest. */
  async receive(req: Request, res: Response): Promise<void> {
    const result = await webhookService.handleIncoming({
      providerKey: req.params.providerKey,
      channelAccountId: req.params.channelAccountId,
      rawBody: req.rawBody ?? Buffer.from(''),
      body: req.body,
      headers: headerMap(req),
    });
    sendSuccess(res, result, 'Webhook received');
  },
};
