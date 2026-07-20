import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

const validRegister = {
  companyName: 'ABC Company',
  fullName: 'Omar Ahmad',
  email: 'owner@example.com',
  password: 'StrongPassword123!',
};

async function registerCompany(overrides: Partial<typeof validRegister> = {}) {
  return request(app)
    .post('/api/v1/auth/register')
    .send({ ...validRegister, ...overrides });
}

describe('POST /api/v1/auth/register', () => {
  it('registers a company and returns tokens without the password hash', async () => {
    const res = await registerCompany();

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
    expect(res.body.data.user.role).toBe('OWNER');
    expect(res.body.data.user.email).toBe('owner@example.com');
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(res.body.data.company.slug).toBe('abc-company');

    // Refresh token is delivered as an httpOnly cookie.
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('refreshToken='))).toBe(true);
    expect(cookies.some((c) => /HttpOnly/i.test(c))).toBe(true);
  });

  it('normalizes the email to lowercase', async () => {
    const res = await registerCompany({ email: 'OWNER@Example.COM' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('owner@example.com');
  });

  it('rejects a duplicate email with 409', async () => {
    await registerCompany();
    const res = await registerCompany({ companyName: 'Another Co' });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.requestId).toEqual(expect.any(String));
  });

  it('fails validation for a weak password', async () => {
    const res = await registerCompany({ password: 'weak' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Validation failed');
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  it('fails validation when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'x@y.com' });
    expect(res.status).toBe(400);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });
});

describe('POST /api/v1/auth/login', () => {
  beforeEach(async () => {
    await registerCompany();
  });

  it('logs in with valid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: validRegister.email, password: validRegister.password });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
  });

  it('rejects an invalid password with 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: validRegister.email, password: 'WrongPassword123' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Invalid email or password');
  });

  it('rejects an unknown email with 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'StrongPassword123!' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns the current user with a valid access token', async () => {
    const reg = await registerCompany();
    const token = reg.body.data.accessToken as string;

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(validRegister.email);
    expect(res.body.data.company.slug).toBe('abc-company');
  });

  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects requests with an invalid token', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('rotates the refresh token and issues a new pair', async () => {
    const reg = await registerCompany();
    const oldRefresh = reg.body.data.refreshToken as string;

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: oldRefresh });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).not.toBe(oldRefresh);
  });

  it('rejects a refresh token that was already rotated (reuse)', async () => {
    const reg = await registerCompany();
    const oldRefresh = reg.body.data.refreshToken as string;

    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: oldRefresh });

    const reuse = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: oldRefresh });

    expect(reuse.status).toBe(401);
  });

  it('rejects when no refresh token is provided', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({});
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('revokes the refresh token so it can no longer be used', async () => {
    const reg = await registerCompany();
    const refreshToken = reg.body.data.refreshToken as string;

    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .send({ refreshToken });
    expect(logout.status).toBe(200);
    expect(logout.body.success).toBe(true);

    const afterLogout = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });
    expect(afterLogout.status).toBe(401);
  });
});

describe('Unknown routes', () => {
  it('returns a 404 in the standard error shape', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.requestId).toEqual(expect.any(String));
  });
});
