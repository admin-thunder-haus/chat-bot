import request from 'supertest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';

/**
 * Public /privacy and /terms. These are the URLs Meta app review and every EU
 * customer will open, so the properties worth pinning are: they are reachable
 * without auth, they are a TEMPLATE whose gaps are loudly visible, and operator
 * input is escaped (the values come from env vars and land in HTML).
 */

const app = createApp();

const LEGAL_KEYS = [
  'LEGAL_ENTITY_NAME',
  'LEGAL_ENTITY_ADDRESS',
  'LEGAL_CONTACT_EMAIL',
  'LEGAL_DATA_RETENTION',
  'LEGAL_JURISDICTION',
] as const;

// The pages read `env` at request time, so a test can set values on the frozen
// snapshot and see them rendered — that is exactly the behaviour that lets the
// owner fill a blank on the server without a code change.
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of LEGAL_KEYS) {
    saved[key] = env[key];
    env[key] = undefined;
  }
});

afterEach(() => {
  for (const key of LEGAL_KEYS) {
    env[key] = saved[key];
  }
});

describe('reachability', () => {
  it.each(['/privacy', '/terms'])('serves %s as public HTML', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('<!doctype html>');
  });

  it('the terms link to the privacy policy', async () => {
    const res = await request(app).get('/terms');
    expect(res.text).toContain('href="/privacy"');
  });
});

describe('unfilled template', () => {
  it.each(['/privacy', '/terms'])(
    '%s shows a banner and inline placeholders while blanks are unset',
    async (path) => {
      const res = await request(app).get(path);
      expect(res.text).toContain('This document is not finished');
      expect(res.text).toContain('FILL IN:');
      // The env var name is named, so the owner knows what to set.
      expect(res.text).toContain('LEGAL_ENTITY_NAME');
    },
  );

  it('names every missing value in the banner', async () => {
    const res = await request(app).get('/privacy');
    // Jurisdiction only appears in the terms body, but the banner lists all of
    // the pending blanks on both pages.
    for (const key of LEGAL_KEYS) {
      expect(res.text).toContain(key);
    }
  });
});

describe('filled template', () => {
  beforeEach(() => {
    env.LEGAL_ENTITY_NAME = 'Thunder Haus LLC';
    env.LEGAL_ENTITY_ADDRESS = '1 Example Street, Amman';
    env.LEGAL_CONTACT_EMAIL = 'privacy@example.test';
    env.LEGAL_DATA_RETENTION = '30 days';
    env.LEGAL_JURISDICTION = 'Jordan';
  });

  it('renders the real values and drops the banner', async () => {
    const res = await request(app).get('/privacy');
    expect(res.text).toContain('Thunder Haus LLC');
    expect(res.text).toContain('1 Example Street, Amman');
    expect(res.text).toContain('30 days');
    expect(res.text).toContain('mailto:privacy@example.test');
    expect(res.text).not.toContain('FILL IN:');
    expect(res.text).not.toContain('This document is not finished');
  });

  it('renders the jurisdiction in the terms', async () => {
    const res = await request(app).get('/terms');
    expect(res.text).toContain('the laws of Jordan');
    expect(res.text).not.toContain('FILL IN:');
  });

  it('escapes operator-supplied values instead of injecting them as HTML', async () => {
    env.LEGAL_ENTITY_NAME = '<script>alert(1)</script> & Co';
    const res = await request(app).get('/terms');
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;');
    expect(res.text).toContain('&amp; Co');
  });
});

describe('content the platform can honestly assert', () => {
  it('the privacy policy describes the actual processors and channels', async () => {
    const res = await request(app).get('/privacy');
    for (const term of ['WhatsApp', 'Instagram', 'Telegram', 'OpenAI']) {
      expect(res.text).toContain(term);
    }
    // Deletion and export exist in the product, so the policy may promise them.
    expect(res.text).toMatch(/delete its entire workspace/i);
    expect(res.text).toMatch(/export its data/i);
  });
});
