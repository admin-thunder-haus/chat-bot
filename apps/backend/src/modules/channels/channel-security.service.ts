import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';

/**
 * Secure credential handling for channel providers.
 *
 * Uses AES-256-GCM (authenticated encryption) via Node's built-in crypto — no
 * custom cryptography. The 32-byte key comes from the environment. Plaintext
 * credentials are only ever decrypted inside backend integration services and
 * are NEVER logged, serialized, or included in thrown errors.
 *
 * Stored payload format (opaque to the rest of the app):
 *   base64(iv).base64(authTag).base64(ciphertext)
 * The `encryptionVersion` column records which scheme produced it, so the
 * format can be rotated later without ambiguity.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce recommended for GCM
const KEY_BYTES = 32; // AES-256
/** Guardrail on credential size (before encryption). */
const MAX_PLAINTEXT_BYTES = 8 * 1024;

export interface EncryptedCredential {
  encryptedPayload: string;
  encryptionVersion: string;
  keyVersion: string | null;
}

let cachedKey: Buffer | null = null;

/**
 * Resolve and validate the encryption key. Decoded from base64; must be exactly
 * 32 bytes. Throwing here (rather than at startup) keeps the key optional until
 * a provider actually stores credentials — the fake provider needs none.
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = env.CHANNEL_CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw AppError.internal(
      'Credential encryption is not configured (CHANNEL_CREDENTIAL_ENCRYPTION_KEY missing)',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw AppError.internal(
      'CHANNEL_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
    );
  }
  cachedKey = key;
  return key;
}

export const channelSecurityService = {
  /** True when a valid encryption key is configured. */
  isConfigured(): boolean {
    try {
      getKey();
      return true;
    } catch {
      return false;
    }
  },

  /** Encrypt a credential object. Returns an opaque, storable payload. */
  encrypt(plaintext: Record<string, unknown>): EncryptedCredential {
    const serialized = JSON.stringify(plaintext);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_PLAINTEXT_BYTES) {
      throw AppError.badRequest('Credential payload is too large');
    }
    const key = getKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(serialized, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    const encryptedPayload = [
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join('.');
    return {
      encryptedPayload,
      encryptionVersion: env.CHANNEL_CREDENTIAL_ENCRYPTION_VERSION,
      keyVersion: null,
    };
  },

  /**
   * Decrypt a stored payload. Throws on any tampering (GCM auth tag mismatch),
   * wrong key, or malformed input. The error message never contains plaintext.
   */
  decrypt(encryptedPayload: string, encryptionVersion?: string): Record<string, unknown> {
    if (
      encryptionVersion &&
      encryptionVersion !== env.CHANNEL_CREDENTIAL_ENCRYPTION_VERSION
    ) {
      throw AppError.internal('Unsupported credential encryption version');
    }
    const parts = encryptedPayload.split('.');
    if (parts.length !== 3) {
      throw AppError.internal('Malformed encrypted credential payload');
    }
    const [ivB64, tagB64, ctB64] = parts;
    const key = getKey();
    try {
      const decipher = createDecipheriv(
        ALGORITHM,
        key,
        Buffer.from(ivB64, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ctB64, 'base64')),
        decipher.final(),
      ]);
      return JSON.parse(plaintext.toString('utf8')) as Record<string, unknown>;
    } catch {
      // Never leak details (wrong key vs tampering) or any plaintext.
      throw AppError.internal('Failed to decrypt credential payload');
    }
  },

  /** Redact a secret for safe logging. */
  redact(_secret: unknown): string {
    return '***redacted***';
  },
};
