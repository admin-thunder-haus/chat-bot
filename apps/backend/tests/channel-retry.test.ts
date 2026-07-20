import { channelRetryService } from '../src/modules/channels';

describe('Channel retry policy', () => {
  it('computes exponential backoff without jitter', () => {
    // Defaults (test env): base 1000ms, factor 2.
    expect(channelRetryService.backoffMs(1, false)).toBe(1000);
    expect(channelRetryService.backoffMs(2, false)).toBe(2000);
    expect(channelRetryService.backoffMs(3, false)).toBe(4000);
    expect(channelRetryService.backoffMs(4, false)).toBe(8000);
  });

  it('caps backoff at the configured maximum', () => {
    // 2^40 * 1000 would be astronomical; must be capped at maxMs (300000).
    expect(channelRetryService.backoffMs(40, false)).toBe(300000);
  });

  it('applies bounded jitter around the base curve', () => {
    for (let i = 0; i < 50; i++) {
      const v = channelRetryService.backoffMs(2, true);
      // base 2000, jitter 0.2 -> within [1600, 2400].
      expect(v).toBeGreaterThanOrEqual(1600);
      expect(v).toBeLessThanOrEqual(2400);
    }
  });

  it('schedules the next attempt in the future', () => {
    const now = new Date('2026-07-20T00:00:00.000Z');
    const next = channelRetryService.nextAttemptAt(1, now);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });

  it('enforces retry eligibility rules', () => {
    // Temporary failures retry until maxAttempts is reached.
    expect(channelRetryService.isRetryable('TEMPORARY', 1, 3)).toBe(true);
    expect(channelRetryService.isRetryable('TEMPORARY', 2, 3)).toBe(true);
    expect(channelRetryService.isRetryable('TEMPORARY', 3, 3)).toBe(false);
    // Permanent failures are never retried.
    expect(channelRetryService.isRetryable('PERMANENT', 1, 3)).toBe(false);
    // NONE (no failure) is not retryable.
    expect(channelRetryService.isRetryable('NONE', 1, 3)).toBe(false);
  });

  it('exposes an expiry instant from the TTL', () => {
    const req = new Date('2026-07-20T00:00:00.000Z');
    const exp = channelRetryService.expiresAt(req);
    expect(exp.getTime()).toBeGreaterThan(req.getTime());
  });
});
