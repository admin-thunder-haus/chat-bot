import { logger } from '../../utils/logger';
import { channelsRepository } from './channels.repository';
import { channelSecurityService } from './channel-security.service';
import type { ProviderCredentials } from './providers/channel-provider.interface';

/**
 * Resolves and decrypts a channel account's stored credentials for backend
 * integration use ONLY. It composes the (encrypted) credential store with the
 * AES-256-GCM security service. Decrypted credentials are never cached, never
 * logged, and never leave the provider boundary. Returns null when no credential
 * exists or decryption fails (callers treat that as "not configured").
 */
export const channelCredentialsService = {
  async load(
    companyId: string,
    channelAccountId: string,
  ): Promise<ProviderCredentials | null> {
    const cred = await channelsRepository.findCredential(
      companyId,
      channelAccountId,
    );
    if (!cred) return null;
    try {
      return channelSecurityService.decrypt(
        cred.encryptedPayload,
        cred.encryptionVersion,
      );
    } catch {
      // Never leak why (wrong key / tampering). Log only non-sensitive ids.
      logger.warn('channel.credentials.decryptFailed', {
        companyId,
        channelAccountId,
      });
      return null;
    }
  },
};
