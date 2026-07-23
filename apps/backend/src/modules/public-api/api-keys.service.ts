import { randomBytes } from 'node:crypto';
import { AppError } from '../../utils/AppError';
import { hashToken } from '../../utils/jwt';
import { publicApiRepository } from './public-api.repository';
import { serializeApiKey, type SerializedApiKey } from './public-api.types';
import type { CreateApiKeyInput } from './public-api.validation';

/** `ak_live_` + 32 hex chars. The prefix column keeps the first 12 for display. */
const KEY_PREFIX_LENGTH = 12;

export function generateApiKey(): string {
  return `ak_live_${randomBytes(16).toString('hex')}`;
}

export const apiKeysService = {
  /**
   * Create a key. The FULL key is returned exactly once here — only its
   * SHA-256 hash is stored (RefreshToken pattern), so it can never be shown
   * again.
   */
  async create(
    companyId: string,
    createdByUserId: string,
    input: CreateApiKeyInput,
  ): Promise<{ apiKey: SerializedApiKey; key: string }> {
    const key = generateApiKey();
    const created = await publicApiRepository.createApiKey(companyId, {
      name: input.name,
      keyPrefix: key.slice(0, KEY_PREFIX_LENGTH),
      keyHash: hashToken(key),
      scopes: input.scopes,
      createdByUserId,
    });
    return { apiKey: serializeApiKey(created), key };
  },

  async list(companyId: string): Promise<SerializedApiKey[]> {
    const keys = await publicApiRepository.listApiKeys(companyId);
    return keys.map(serializeApiKey);
  },

  /** Revoke (idempotent — revoking twice keeps the first revocation time). */
  async revoke(companyId: string, id: string): Promise<SerializedApiKey> {
    const revoked = await publicApiRepository.revokeApiKey(companyId, id);
    if (!revoked) throw AppError.notFound('API key not found');
    return serializeApiKey(revoked);
  },
};
