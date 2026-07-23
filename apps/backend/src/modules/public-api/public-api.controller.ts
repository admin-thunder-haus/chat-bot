import type { Request, Response } from 'express';
import { apiKeysService } from './api-keys.service';
import { outboundWebhooksService } from './outbound-webhooks.service';
import { publicApiPublicService } from './public-api.public.service';
import { sendSuccess } from '../../utils/apiResponse';

/** Dashboard-facing management endpoints (JWT-authenticated). */
export const publicApiManagementController = {
  // --- API keys ---

  async createApiKey(req: Request, res: Response): Promise<void> {
    const result = await apiKeysService.create(
      req.user!.companyId,
      req.user!.id,
      req.body,
    );
    sendSuccess(
      res,
      result,
      'API key created — store it now, it will not be shown again',
      201,
    );
  },

  async listApiKeys(req: Request, res: Response): Promise<void> {
    const apiKeys = await apiKeysService.list(req.user!.companyId);
    sendSuccess(res, { apiKeys }, 'API keys retrieved successfully');
  },

  async revokeApiKey(req: Request, res: Response): Promise<void> {
    const apiKey = await apiKeysService.revoke(
      req.user!.companyId,
      req.params.apiKeyId,
    );
    sendSuccess(res, { apiKey }, 'API key revoked successfully');
  },

  // --- Outbound webhooks ---

  async createWebhook(req: Request, res: Response): Promise<void> {
    const result = await outboundWebhooksService.create(
      req.user!.companyId,
      req.body,
    );
    sendSuccess(
      res,
      result,
      'Webhook created — store the secret now, it will not be shown again',
      201,
    );
  },

  async listWebhooks(req: Request, res: Response): Promise<void> {
    const webhooks = await outboundWebhooksService.list(req.user!.companyId);
    sendSuccess(res, { webhooks }, 'Webhooks retrieved successfully');
  },

  async updateWebhook(req: Request, res: Response): Promise<void> {
    const webhook = await outboundWebhooksService.update(
      req.user!.companyId,
      req.params.webhookId,
      req.body,
    );
    sendSuccess(res, { webhook }, 'Webhook updated successfully');
  },

  async removeWebhook(req: Request, res: Response): Promise<void> {
    await outboundWebhooksService.remove(
      req.user!.companyId,
      req.params.webhookId,
    );
    sendSuccess(res, null, 'Webhook deleted successfully');
  },

  async listWebhookDeliveries(req: Request, res: Response): Promise<void> {
    const deliveries = await outboundWebhooksService.listDeliveries(
      req.user!.companyId,
      req.params.webhookId,
    );
    sendSuccess(res, { deliveries }, 'Deliveries retrieved successfully');
  },
};

/** Third-party-facing endpoints (API-key-authenticated). */
export const publicApiController = {
  async me(req: Request, res: Response): Promise<void> {
    const result = await publicApiPublicService.me(req.apiKey!);
    sendSuccess(res, result, 'API key details retrieved successfully');
  },

  async listConversations(req: Request, res: Response): Promise<void> {
    const result = await publicApiPublicService.listConversations(
      req.apiKey!.companyId,
      req.query as never,
    );
    sendSuccess(res, result, 'Conversations retrieved successfully');
  },

  async getConversation(req: Request, res: Response): Promise<void> {
    const result = await publicApiPublicService.getConversation(
      req.apiKey!.companyId,
      req.params.conversationId,
    );
    sendSuccess(res, result, 'Conversation retrieved successfully');
  },

  async listCustomers(req: Request, res: Response): Promise<void> {
    const result = await publicApiPublicService.listCustomers(
      req.apiKey!.companyId,
      req.query as never,
    );
    sendSuccess(res, result, 'Customers retrieved successfully');
  },
};
