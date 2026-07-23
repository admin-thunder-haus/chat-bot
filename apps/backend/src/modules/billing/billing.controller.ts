import type { Request, Response } from 'express';
import { billingService, type StripeEvent } from './billing.service';
import { verifyStripeSignature } from './stripe.provider';
import { AppError } from '../../utils/AppError';
import { sendSuccess } from '../../utils/apiResponse';

export const billingController = {
  async getSubscription(req: Request, res: Response): Promise<void> {
    const subscription = await billingService.getSubscription(
      req.user!.companyId,
    );
    sendSuccess(res, { subscription }, 'Subscription retrieved successfully');
  },

  async listPlans(_req: Request, res: Response): Promise<void> {
    const plans = await billingService.listPlans();
    sendSuccess(res, { plans }, 'Plans retrieved successfully');
  },

  async changePlan(req: Request, res: Response): Promise<void> {
    const result = await billingService.changePlan(
      req.user!.companyId,
      req.body.planCode,
      req.body.billingCycle,
    );
    sendSuccess(res, result, 'Plan change processed successfully');
  },

  async cancel(req: Request, res: Response): Promise<void> {
    const subscription = await billingService.cancel(req.user!.companyId);
    sendSuccess(
      res,
      { subscription },
      'Subscription will be canceled at the end of the current period',
    );
  },

  async resume(req: Request, res: Response): Promise<void> {
    const subscription = await billingService.resume(req.user!.companyId);
    sendSuccess(res, { subscription }, 'Subscription resumed successfully');
  },

  /**
   * Public Stripe webhook (no JWT). The signature is verified against the raw
   * request bytes whenever STRIPE_WEBHOOK_SECRET is configured.
   */
  async stripeWebhook(req: Request, res: Response): Promise<void> {
    const signature = req.headers['stripe-signature'];
    const ok = verifyStripeSignature(
      req.rawBody,
      typeof signature === 'string' ? signature : undefined,
    );
    if (!ok) {
      throw AppError.badRequest('Invalid webhook signature');
    }
    const result = await billingService.handleStripeWebhook(
      req.body as StripeEvent,
    );
    sendSuccess(
      res,
      { received: true, handled: result.handled },
      'Webhook processed',
    );
  },
};
