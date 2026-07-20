import express from 'express';
import request from 'supertest';
import { createRateLimiter } from '../src/middlewares/rateLimit.middleware';
import { requestId } from '../src/middlewares/requestId.middleware';

/**
 * Rate-limit behavior is verified against a purpose-built mini app so the
 * functional suite (which runs with limiters skipped) stays fast, while these
 * tests exercise the real limiter factory with limits enabled.
 */
function buildApp(max: number) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(requestId);
  const limiter = createRateLimiter({ windowMs: 60_000, max, skipInTest: false });
  app.use('/api/test', limiter, (_req, res) => {
    res.status(200).json({ success: true, message: 'ok', data: null });
  });
  return app;
}

describe('Rate limiting', () => {
  it('allows normal request volume under the limit (no false 429s)', async () => {
    const app = buildApp(50);
    for (let i = 0; i < 20; i++) {
      const res = await request(app).get('/api/test');
      expect(res.status).toBe(200);
    }
  });

  it('returns 429 in the standard API error format once the limit is exceeded', async () => {
    const app = buildApp(3);
    let last;
    for (let i = 0; i < 5; i++) {
      last = await request(app).get('/api/test');
    }
    expect(last!.status).toBe(429);
    expect(last!.body.success).toBe(false);
    expect(last!.body.message).toMatch(/too many requests/i);
    expect(Array.isArray(last!.body.errors)).toBe(true);
    expect(last!.body.requestId).toEqual(expect.any(String));
    // Standard rate-limit headers + Retry-After are present.
    expect(last!.headers['retry-after']).toBeDefined();
    expect(last!.headers['ratelimit-limit']).toBeDefined();
  });

  it('does not count OPTIONS (CORS preflight) against the limit', async () => {
    const app = buildApp(2);
    // Fire many preflights — none should be throttled.
    for (let i = 0; i < 10; i++) {
      const res = await request(app).options('/api/test');
      expect(res.status).not.toBe(429);
    }
    // A normal GET still works afterwards.
    const res = await request(app).get('/api/test');
    expect(res.status).toBe(200);
  });

  it('does not count /health probes against the limit', async () => {
    const app = express();
    app.use(requestId);
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, skipInTest: false });
    app.use(limiter);
    app.get('/api/v1/health', (_req, res) => res.json({ ok: true }));
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
    }
  });
});
