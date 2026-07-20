import type { Request, Response } from 'express';
import { channelsService } from './channels.service';
import { channelHealthService } from './channel-health.service';
import { channelDeliveryService } from './channel-delivery.service';
import { sendSuccess } from '../../utils/apiResponse';

export const channelsController = {
  async listProviders(_req: Request, res: Response): Promise<void> {
    const providers = channelsService.listProviders();
    sendSuccess(res, { providers }, 'Providers retrieved successfully');
  },

  async list(req: Request, res: Response): Promise<void> {
    const accounts = await channelsService.listAccounts(
      req.user!.companyId,
      req.query as never,
    );
    sendSuccess(res, { accounts }, 'Channel accounts retrieved successfully');
  },

  async getOne(req: Request, res: Response): Promise<void> {
    const account = await channelsService.getAccount(
      req.user!.companyId,
      req.params.channelAccountId,
    );
    sendSuccess(res, { account }, 'Channel account retrieved successfully');
  },

  async create(req: Request, res: Response): Promise<void> {
    const account = await channelsService.createAccount(
      req.user!.companyId,
      req.user!.id,
      req.body,
    );
    sendSuccess(res, { account }, 'Channel account created successfully', 201);
  },

  async connectWhatsApp(req: Request, res: Response): Promise<void> {
    const { displayName, ...payload } = req.body as {
      displayName: string;
      [k: string]: unknown;
    };
    const account = await channelsService.connectCredentialedProvider(
      req.user!.companyId,
      req.user!.id,
      'whatsapp',
      displayName,
      payload,
    );
    sendSuccess(res, { account }, 'WhatsApp connected successfully', 201);
  },

  async update(req: Request, res: Response): Promise<void> {
    const account = await channelsService.updateAccount(
      req.user!.companyId,
      req.params.channelAccountId,
      req.user!.id,
      req.body,
    );
    sendSuccess(res, { account }, 'Channel account updated successfully');
  },

  async setStatus(req: Request, res: Response): Promise<void> {
    const account = await channelsService.setStatus(
      req.user!.companyId,
      req.params.channelAccountId,
      req.user!.id,
      req.body,
    );
    sendSuccess(res, { account }, 'Channel account status updated successfully');
  },

  async remove(req: Request, res: Response): Promise<void> {
    const account = await channelsService.disconnect(
      req.user!.companyId,
      req.params.channelAccountId,
      req.user!.id,
    );
    sendSuccess(res, { account }, 'Channel account disconnected successfully');
  },

  async healthCheck(req: Request, res: Response): Promise<void> {
    const account = await channelHealthService.runHealthCheck(
      req.user!.companyId,
      req.params.channelAccountId,
      req.user!.id,
    );
    sendSuccess(res, { account }, 'Health check completed');
  },

  async getWidgetConfig(req: Request, res: Response): Promise<void> {
    const result = await channelsService.getWebChatConfig(
      req.user!.companyId,
      req.params.channelAccountId,
    );
    sendSuccess(res, result, 'Web Chat config retrieved successfully');
  },

  async updateWidgetConfig(req: Request, res: Response): Promise<void> {
    const result = await channelsService.updateWebChatConfig(
      req.user!.companyId,
      req.params.channelAccountId,
      req.user!.id,
      req.body,
    );
    sendSuccess(res, result, 'Web Chat config updated successfully');
  },

  async diagnostics(req: Request, res: Response): Promise<void> {
    // Ensure the account belongs to the tenant (404 otherwise) via the service.
    const diagnostics = await channelHealthService.getDiagnostics(
      req.user!.companyId,
      req.params.channelAccountId,
    );
    sendSuccess(res, diagnostics, 'Channel diagnostics retrieved successfully');
  },

  async retryDelivery(req: Request, res: Response): Promise<void> {
    // Confirm tenant ownership of the account before touching the delivery.
    await channelsService.getAccount(
      req.user!.companyId,
      req.params.channelAccountId,
    );
    const result = await channelDeliveryService.manualRetry(
      req.user!.companyId,
      req.params.deliveryId,
      req.user!.id,
    );
    sendSuccess(res, { result }, 'Delivery retry processed');
  },
};
