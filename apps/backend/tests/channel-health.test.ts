import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';
import { createFakeChannel } from './channel-helpers';

const app = createApp();
let acme: Tenant;
let globex: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
});

function healthCheck(id: string, token: string) {
  return request(app)
    .post(`/api/v1/channels/${id}/health-check`)
    .set(authHeader(token));
}

describe('Channel health checks', () => {
  it('marks a healthy account HEALTHY and stamps timestamps', async () => {
    const created = await createFakeChannel(app, acme.tokens.owner);
    const id = created.body.data.account.id;
    const res = await healthCheck(id, acme.tokens.owner);
    expect(res.status).toBe(200);
    expect(res.body.data.account.connectionState).toBe('HEALTHY');
    expect(res.body.data.account.lastHealthCheckAt).not.toBeNull();
    expect(res.body.data.account.lastHealthyAt).not.toBeNull();
    expect(res.body.data.account.lastErrorCode).toBeNull();
  });

  it('records a safe error state on a simulated unhealthy connection', async () => {
    const created = await createFakeChannel(app, acme.tokens.owner, {
      metadata: { healthSimulation: 'unavailable' },
    });
    const id = created.body.data.account.id;
    const res = await healthCheck(id, acme.tokens.owner);
    expect(res.body.data.account.connectionState).toBe('UNAVAILABLE');
    expect(res.body.data.account.lastErrorCode).toBe('SIMULATED_UNAVAILABLE');
    // Error message is a safe summary, not provider internals.
    expect(res.body.data.account.lastErrorMessage).toEqual(expect.any(String));
  });

  it('AGENT cannot trigger a health check', async () => {
    const created = await createFakeChannel(app, acme.tokens.owner);
    const id = created.body.data.account.id;
    const res = await healthCheck(id, acme.tokens.agent);
    expect(res.status).toBe(403);
  });

  it('cross-tenant health check returns 404', async () => {
    const created = await createFakeChannel(app, acme.tokens.owner);
    const id = created.body.data.account.id;
    const res = await healthCheck(id, globex.tokens.owner);
    expect(res.status).toBe(404);
  });
});
