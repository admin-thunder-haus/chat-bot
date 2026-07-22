import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { channelsService } from './channels.service';
import { channelHealthService } from './channel-health.service';
import { channelDeliveryService } from './channel-delivery.service';
import { channelRegistry } from './channel-registry';
import { TelegramChannelProvider } from './providers/telegram';
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

  async connectInstagram(req: Request, res: Response): Promise<void> {
    const { displayName, ...payload } = req.body as {
      displayName: string;
      [k: string]: unknown;
    };
    // Store encrypted credentials + create the account (state UNKNOWN).
    const created = await channelsService.connectCredentialedProvider(
      req.user!.companyId,
      req.user!.id,
      'instagram',
      displayName,
      payload,
    );
    // Immediately validate against the Graph API so the reported state is
    // honest (never a false "connected"). The account is preserved in whatever
    // state the probe yields (HEALTHY / AUTH_EXPIRED / DEGRADED / UNAVAILABLE).
    const account = await channelHealthService.runHealthCheck(
      req.user!.companyId,
      created.id,
      req.user!.id,
    );
    const message =
      account.connectionState === 'HEALTHY'
        ? 'Instagram connection verified and active'
        : account.connectionState === 'AUTH_EXPIRED'
          ? 'Instagram credentials saved, but authentication failed — check the access token'
          : account.connectionState === 'UNAVAILABLE'
            ? 'Instagram credentials saved, but the account could not be verified'
            : 'Instagram credentials saved; verification pending';
    sendSuccess(res, { account }, message, 201);
  },

  async connectFacebook(req: Request, res: Response): Promise<void> {
    const { displayName, ...payload } = req.body as {
      displayName: string;
      [k: string]: unknown;
    };
    const created = await channelsService.connectCredentialedProvider(
      req.user!.companyId,
      req.user!.id,
      'facebook',
      displayName,
      payload,
    );
    // Validate against the Graph API so the reported state is honest.
    const account = await channelHealthService.runHealthCheck(
      req.user!.companyId,
      created.id,
      req.user!.id,
    );
    const message =
      account.connectionState === 'HEALTHY'
        ? 'Facebook Messenger connection verified and active'
        : account.connectionState === 'AUTH_EXPIRED'
          ? 'Facebook credentials saved, but authentication failed — check the Page access token'
          : account.connectionState === 'UNAVAILABLE'
            ? 'Facebook credentials saved, but the Page could not be verified'
            : 'Facebook credentials saved; verification pending';
    sendSuccess(res, { account }, message, 201);
  },

  async connectTelegram(req: Request, res: Response): Promise<void> {
    const { displayName, botToken } = req.body as {
      displayName: string;
      botToken: string;
    };
    // The webhook secret token is generated server-side (never client-supplied),
    // stored encrypted, and set on Telegram via setWebhook below.
    const secretToken = randomBytes(24).toString('hex');
    const created = await channelsService.connectCredentialedProvider(
      req.user!.companyId,
      req.user!.id,
      'telegram',
      displayName,
      { botToken, secretToken },
    );
    // Register the webhook with Telegram so it pushes updates to our per-account
    // URL (the "subscribe" equivalent). Derived from the public request host.
    const webhookUrl = `${req.protocol}://${req.get('host')}/api/v1/webhooks/telegram/${created.id}`;
    const provider = channelRegistry.tryGet('telegram');
    let webhookRegistered = false;
    if (provider instanceof TelegramChannelProvider) {
      const r = await provider.registerWebhook({ botToken, url: webhookUrl, secretToken });
      webhookRegistered = r.ok;
    }
    const account = await channelHealthService.runHealthCheck(
      req.user!.companyId,
      created.id,
      req.user!.id,
    );
    const message =
      account.connectionState === 'HEALTHY' && webhookRegistered
        ? 'Telegram connection verified and webhook active'
        : account.connectionState === 'HEALTHY'
          ? 'Telegram bot verified, but the webhook could not be set — retry or set it manually'
          : account.connectionState === 'AUTH_EXPIRED'
            ? 'Telegram bot token is invalid — check the token from @BotFather'
            : 'Telegram credentials saved; verification pending';
    sendSuccess(res, { account, webhookRegistered }, message, 201);
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

  async deletePermanently(req: Request, res: Response): Promise<void> {
    await channelsService.deletePermanently(
      req.user!.companyId,
      req.params.channelAccountId,
    );
    sendSuccess(res, null, 'Channel account deleted permanently');
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
