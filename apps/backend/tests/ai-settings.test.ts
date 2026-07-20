import request from 'supertest';
import { createApp } from '../src/app';
import { setupTenant, authHeader, type Tenant } from './helpers';

const app = createApp();
let acme: Tenant;
let globex: Tenant;

beforeEach(async () => {
  acme = await setupTenant('acme');
  globex = await setupTenant('globex');
});

describe('AI settings', () => {
  it('returns defaults when none exist (autoReplyEnabled=false)', async () => {
    const res = await request(app)
      .get('/api/v1/ai-settings')
      .set(authHeader(acme.tokens.owner));
    expect(res.status).toBe(200);
    expect(res.body.data.settings.id).toBeNull();
    expect(res.body.data.settings.replyTone).toBe('PROFESSIONAL');
    expect(res.body.data.settings.autoReplyEnabled).toBe(false);
  });

  it('AGENT can read settings', async () => {
    const res = await request(app)
      .get('/api/v1/ai-settings')
      .set(authHeader(acme.tokens.agent));
    expect(res.status).toBe(200);
  });

  it('OWNER can create/update via upsert', async () => {
    const res = await request(app)
      .put('/api/v1/ai-settings')
      .set(authHeader(acme.tokens.owner))
      .send({
        assistantName: 'Aria',
        replyTone: 'FRIENDLY',
        useEmojis: true,
        maxReplyLength: 500,
      });
    expect(res.status).toBe(200);
    expect(res.body.data.settings.id).not.toBeNull();
    expect(res.body.data.settings.assistantName).toBe('Aria');
    expect(res.body.data.settings.replyTone).toBe('FRIENDLY');

    // A second PUT updates the same row.
    const upd = await request(app)
      .put('/api/v1/ai-settings')
      .set(authHeader(acme.tokens.owner))
      .send({ replyTone: 'FORMAL' });
    expect(upd.body.data.settings.replyTone).toBe('FORMAL');
    expect(upd.body.data.settings.assistantName).toBe('Aria');
  });

  it('ADMIN can update', async () => {
    const res = await request(app)
      .put('/api/v1/ai-settings')
      .set(authHeader(acme.tokens.admin))
      .send({ replyTone: 'CASUAL' });
    expect(res.status).toBe(200);
  });

  it('AGENT cannot update', async () => {
    const res = await request(app)
      .put('/api/v1/ai-settings')
      .set(authHeader(acme.tokens.agent))
      .send({ replyTone: 'CASUAL' });
    expect(res.status).toBe(403);
  });

  it('rejects invalid settings (bad tone, out-of-range maxReplyLength)', async () => {
    expect(
      (
        await request(app)
          .put('/api/v1/ai-settings')
          .set(authHeader(acme.tokens.owner))
          .send({ replyTone: 'SASSY' })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .put('/api/v1/ai-settings')
          .set(authHeader(acme.tokens.owner))
          .send({ maxReplyLength: 10 })
      ).status,
    ).toBe(400);
  });

  it('isolates settings between tenants', async () => {
    await request(app)
      .put('/api/v1/ai-settings')
      .set(authHeader(acme.tokens.owner))
      .send({ assistantName: 'AcmeBot' });

    const res = await request(app)
      .get('/api/v1/ai-settings')
      .set(authHeader(globex.tokens.owner));
    // Globex has no settings -> defaults, not Acme's.
    expect(res.body.data.settings.assistantName).toBeNull();
  });
});
