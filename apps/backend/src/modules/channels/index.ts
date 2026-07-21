export { channelsRoutes } from './channels.routes';
export { webhookRoutes } from './webhooks/webhook.routes';
export {
  channelRegistry,
  registerBuiltInProviders,
  type ChannelProviderDescriptor,
} from './channel-registry';
export { channelPipelineService } from './channel-pipeline.service';
export { channelDeliveryService } from './channel-delivery.service';
export { channelRetryService, getRetryPolicy } from './channel-retry.service';
export { channelsService } from './channels.service';
export { channelHealthService } from './channel-health.service';
export { channelSecurityService } from './channel-security.service';
export { channelsRepository } from './channels.repository';
export { FakeChannelProvider } from './providers/fake-channel.provider';
export {
  WebChatChannelProvider,
  WEBCHAT_PROVIDER_KEY,
} from './providers/webchat-channel.provider';
export type { WebChatInboundPayload } from './providers/webchat-channel.provider';
export {
  DEFAULT_WEBCHAT_CONFIG,
  readWebChatConfig,
} from './providers/webchat.config';
export type { WebChatConfig } from './providers/webchat.config';
export {
  WhatsAppChannelProvider,
  WHATSAPP_PROVIDER_KEY,
  WHATSAPP_SIGNATURE_HEADER,
  setWhatsAppTransportForTesting,
} from './providers/whatsapp';
export type {
  WhatsAppTransport,
  WhatsAppConfig,
  WhatsAppCredentials,
} from './providers/whatsapp';
export {
  InstagramChannelProvider,
  INSTAGRAM_PROVIDER_KEY,
  INSTAGRAM_SIGNATURE_HEADER,
  setInstagramTransportForTesting,
  normalizeInstagramWebhook,
  classifyInstagramHttp,
} from './providers/instagram';
export type {
  InstagramTransport,
  InstagramConfig,
  InstagramCredentials,
  InstagramErrorCategory,
} from './providers/instagram';
export {
  FacebookChannelProvider,
  FACEBOOK_PROVIDER_KEY,
  FACEBOOK_SIGNATURE_HEADER,
  setFacebookTransportForTesting,
  normalizeFacebookWebhook,
  classifyFacebookHttp,
} from './providers/facebook';
export type {
  FacebookTransport,
  FacebookConfig,
  FacebookCredentials,
  FacebookErrorCategory,
} from './providers/facebook';
export { channelCredentialsService } from './channel-credentials.service';
export type { ChannelProvider } from './providers/channel-provider.interface';
