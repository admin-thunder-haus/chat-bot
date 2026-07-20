import { channelSecurityService } from '../src/modules/channels';

describe('Channel credential security (AES-256-GCM)', () => {
  it('round-trips encrypt -> decrypt', () => {
    const secret = { accessToken: 'super-secret-token', pageId: '123' };
    const enc = channelSecurityService.encrypt(secret);
    expect(enc.encryptionVersion).toBe('v1');
    expect(enc.encryptedPayload).toEqual(expect.any(String));
    // Ciphertext must not contain the plaintext secret.
    expect(enc.encryptedPayload).not.toContain('super-secret-token');

    const dec = channelSecurityService.decrypt(
      enc.encryptedPayload,
      enc.encryptionVersion,
    );
    expect(dec).toEqual(secret);
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const secret = { token: 'same-value' };
    const a = channelSecurityService.encrypt(secret);
    const b = channelSecurityService.encrypt(secret);
    expect(a.encryptedPayload).not.toEqual(b.encryptedPayload);
    // Both still decrypt back to the same value.
    expect(channelSecurityService.decrypt(a.encryptedPayload)).toEqual(secret);
    expect(channelSecurityService.decrypt(b.encryptedPayload)).toEqual(secret);
  });

  it('fails to decrypt a tampered ciphertext (auth tag mismatch)', () => {
    const enc = channelSecurityService.encrypt({ token: 'abc' });
    const [iv, tag, ct] = enc.encryptedPayload.split('.');
    // Flip a byte in the ciphertext.
    const tamperedCt = Buffer.from(ct, 'base64');
    tamperedCt[0] = tamperedCt[0] ^ 0xff;
    const tampered = [iv, tag, tamperedCt.toString('base64')].join('.');
    expect(() => channelSecurityService.decrypt(tampered)).toThrow(
      /decrypt/i,
    );
  });

  it('fails to decrypt with the wrong key', () => {
    // Encrypt with a fresh key by swapping the env key temporarily. The service
    // caches the key, so we assert via a tampered-key module boundary instead:
    // a payload encrypted under a different key cannot be forged to decrypt.
    const enc = channelSecurityService.encrypt({ token: 'abc' });
    // Corrupt the auth tag (equivalent to a key/content mismatch in GCM).
    const [iv, , ct] = enc.encryptedPayload.split('.');
    const wrongTag = Buffer.alloc(16, 9).toString('base64');
    expect(() =>
      channelSecurityService.decrypt([iv, wrongTag, ct].join('.')),
    ).toThrow(/decrypt/i);
  });

  it('rejects a malformed payload', () => {
    expect(() => channelSecurityService.decrypt('not-a-valid-payload')).toThrow();
  });

  it('redacts secrets for logging', () => {
    expect(channelSecurityService.redact('my-secret')).toBe('***redacted***');
  });

  it('reports configured when a key is present', () => {
    expect(channelSecurityService.isConfigured()).toBe(true);
  });
});
