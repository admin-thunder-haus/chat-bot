import request from 'supertest';
import { createApp } from '../src/app';
import { mailer } from '../src/utils/mailer';

const app = createApp();

const validRegister = {
  companyName: 'ABC Company',
  fullName: 'Omar Ahmad',
  email: 'owner@example.com',
  password: 'StrongPassword123!',
  confirmPassword: 'StrongPassword123!',
};

let sendVerificationSpy: jest.SpyInstance;

beforeEach(() => {
  sendVerificationSpy = jest
    .spyOn(mailer, 'sendVerificationEmail')
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** The last verification code captured by the mailer spy. */
function lastEmailedCode(): string {
  const calls = sendVerificationSpy.mock.calls;
  if (calls.length === 0) throw new Error('no verification email was sent');
  return calls[calls.length - 1][0].code as string;
}

async function registerCompany(overrides: Partial<typeof validRegister> = {}) {
  return request(app)
    .post('/api/v1/auth/register')
    .send({ ...validRegister, ...overrides });
}

/** Register + confirm the emailed code; returns the verify response (tokens). */
async function registerAndVerify(
  overrides: Partial<typeof validRegister> = {},
) {
  const email = overrides.email ?? validRegister.email;
  await registerCompany(overrides);
  return request(app)
    .post('/api/v1/auth/verify-email')
    .send({ email, code: lastEmailedCode() });
}

describe('POST /api/v1/auth/register', () => {
  it('registers a company, sends a code, and issues NO tokens', async () => {
    const res = await registerCompany();

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.requiresEmailVerification).toBe(true);
    expect(res.body.data.accessToken).toBeUndefined();
    expect(res.body.data.refreshToken).toBeUndefined();
    expect(res.body.data.user.role).toBe('OWNER');
    expect(res.body.data.user.email).toBe('owner@example.com');
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(res.body.data.user.emailVerifiedAt).toBeNull();
    expect(res.body.data.company.slug).toBe('abc-company');

    // No refresh cookie before the email is verified.
    const cookies = (res.headers['set-cookie'] ?? []) as unknown as string[];
    expect(cookies.some((c) => c.startsWith('refreshToken='))).toBe(false);

    // A verification email went out with a 6-digit code.
    expect(sendVerificationSpy).toHaveBeenCalledTimes(1);
    expect(lastEmailedCode()).toMatch(/^\d{6}$/);
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
    const res = await registerCompany({
      password: 'weak',
      confirmPassword: 'weak',
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Validation failed');
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  it('rejects mismatched password confirmation', async () => {
    const res = await registerCompany({
      confirmPassword: 'DifferentPassword123',
    });

    expect(res.status).toBe(400);
    expect(
      res.body.errors.some(
        (e: { field?: string }) => e.field === 'confirmPassword',
      ),
    ).toBe(true);
  });

  it('rejects a missing password confirmation', async () => {
    const { confirmPassword: _omitted, ...withoutConfirm } = validRegister;
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(withoutConfirm);
    expect(res.status).toBe(400);
  });

  it('fails validation when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'x@y.com' });
    expect(res.status).toBe(400);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });
});

describe('POST /api/v1/auth/verify-email', () => {
  it('verifies the code, marks the user verified, and logs them in', async () => {
    await registerCompany();
    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: validRegister.email, code: lastEmailedCode() });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
    expect(res.body.data.user.emailVerifiedAt).toEqual(expect.any(String));

    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('refreshToken='))).toBe(true);
  });

  it('rejects a wrong code with a generic error', async () => {
    await registerCompany();
    const wrong = lastEmailedCode() === '000000' ? '111111' : '000000';

    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: validRegister.email, code: wrong });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid or expired verification code');
  });

  it('rejects an unknown email with the same generic error', async () => {
    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: 'nobody@example.com', code: '123456' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid or expired verification code');
  });

  it('rejects reuse of an already-consumed code', async () => {
    await registerCompany();
    const code = lastEmailedCode();

    const first = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: validRegister.email, code });
    expect(first.status).toBe(200);

    const reuse = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: validRegister.email, code });
    expect(reuse.status).toBe(409);
    expect(reuse.body.code).toBe('EMAIL_ALREADY_VERIFIED');
  });

  it('rejects a non-numeric code shape at validation', async () => {
    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: validRegister.email, code: 'abcdef' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
  });
});

describe('POST /api/v1/auth/login', () => {
  it('blocks login before the email is verified (EMAIL_NOT_VERIFIED)', async () => {
    await registerCompany();

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: validRegister.email, password: validRegister.password });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('logs in with valid credentials after verification', async () => {
    await registerAndVerify();

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: validRegister.email, password: validRegister.password });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
  });

  it('rejects an invalid password with 401', async () => {
    await registerAndVerify();

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
    const verified = await registerAndVerify();
    const token = verified.body.data.accessToken as string;

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
    const verified = await registerAndVerify();
    const oldRefresh = verified.body.data.refreshToken as string;

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: oldRefresh });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).not.toBe(oldRefresh);
  });

  it('rejects a refresh token that was already rotated (reuse)', async () => {
    const verified = await registerAndVerify();
    const oldRefresh = verified.body.data.refreshToken as string;

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
    const verified = await registerAndVerify();
    const refreshToken = verified.body.data.refreshToken as string;

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
