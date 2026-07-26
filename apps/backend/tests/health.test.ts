import request from 'supertest';
import { createApp } from '../src/app';
import { authHeader, setupTenant, type Tenant } from './helpers';

const app = createApp();

describe('Health endpoints', () => {
  it('GET /health returns liveness ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
  });

  it('GET /api/v1/health verifies database connectivity', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.database).toBe('up');
  });
});

/**
 * The operator-facing readiness surface. Both routes exist so the owner can
 * answer "is error tracking really on in THIS deployment, and do errors really
 * arrive?" without reading startup logs — see docs/LAUNCH-CHECKLIST.md.
 */
describe('operator readiness endpoints', () => {
  let acme: Tenant;

  beforeEach(async () => {
    acme = await setupTenant('acme');
  });

  describe('GET /api/v1/health/integrations', () => {
    it('reports booleans only — never a DSN, host or key', async () => {
      const res = await request(app)
        .get('/api/v1/health/integrations')
        .set(authHeader(acme.tokens.owner));

      expect(res.status).toBe(200);
      // Sentry and SMTP are both unconfigured in tests, which is the point:
      // the endpoint must report "off" rather than guess.
      expect(res.body.data).toEqual({ sentry: false, smtp: false });

      // Nothing secret-shaped may appear in the payload.
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/dsn|sentry\.io|smtp-relay|password|xsmtp/i);
    });

    it('is OWNER-only and requires authentication', async () => {
      expect(
        (await request(app).get('/api/v1/health/integrations')).status,
      ).toBe(401);
      expect(
        (
          await request(app)
            .get('/api/v1/health/integrations')
            .set(authHeader(acme.tokens.admin))
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .get('/api/v1/health/integrations')
            .set(authHeader(acme.tokens.agent))
        ).status,
      ).toBe(403);
    });
  });

  describe('POST /api/v1/health/test-error', () => {
    it('produces a real 500 through the central error middleware', async () => {
      const res = await request(app)
        .post('/api/v1/health/test-error')
        .set(authHeader(acme.tokens.owner));

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      // The generic message proves it went through normalize(), i.e. the same
      // path a genuine unexpected error takes — which is what makes this a
      // valid end-to-end test of the Sentry hook.
      expect(res.body.message).toBe('Internal server error');
      expect(res.body.requestId).toEqual(expect.any(String));
    });

    it('is OWNER-only and requires authentication', async () => {
      expect((await request(app).post('/api/v1/health/test-error')).status).toBe(
        401,
      );
      expect(
        (
          await request(app)
            .post('/api/v1/health/test-error')
            .set(authHeader(acme.tokens.admin))
        ).status,
      ).toBe(403);
    });
  });
});
