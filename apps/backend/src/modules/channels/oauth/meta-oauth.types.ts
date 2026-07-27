/**
 * Shared OAuth vocabulary, in its own module so the selection store and the
 * service can both use it without importing each other (the service imports
 * the store, so the arrow must not point back).
 */

export type MetaOauthProvider = 'facebook' | 'instagram' | 'whatsapp';

export const META_PROVIDERS: readonly MetaOauthProvider[] = [
  'facebook',
  'instagram',
  'whatsapp',
];

export function isMetaOauthProvider(v: unknown): v is MetaOauthProvider {
  return (
    typeof v === 'string' && META_PROVIDERS.includes(v as MetaOauthProvider)
  );
}
