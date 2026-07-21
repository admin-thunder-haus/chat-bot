export {
  FacebookChannelProvider,
  FACEBOOK_PROVIDER_KEY,
  FACEBOOK_SIGNATURE_HEADER,
} from './facebook-channel.provider';
export {
  setFacebookTransportForTesting,
  facebookApiClient,
} from './facebook-api-client';
export type {
  FacebookTransport,
  FacebookHttpRequest,
  FacebookHttpResponse,
} from './facebook-api-client';
export {
  classifyFacebookHttp,
  classifyFacebookThrow,
  safeFacebookReason,
} from './facebook-error-classifier';
export type { FacebookErrorCategory } from './facebook-error-classifier';
export { normalizeFacebookWebhook } from './facebook-normalizer';
export type { FacebookConfig, FacebookCredentials } from './facebook.types';
