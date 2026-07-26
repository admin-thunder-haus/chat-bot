import request from 'supertest';
import { createApp } from '../src/app';
import { mailer } from '../src/utils/mailer';
import { hashToken } from '../src/utils/jwt';
import { hashPassword } from '../src/utils/password';
import { prisma } from './setup';

/**
 * Forgot / reset password. Covers the security properties that matter more than
 * the happy path: no email enumeration, single-use TTL'd tokens, and — the one
 * that makes a reset actually SAFE — every existing session dying with the old
 * password.
 */

const app = createApp();

const EMAIL = 'reset-me@example.com';
const OLD_PASSWORD = 'OldPassword123';
const NEW_PASSWORD = 'BrandNewPass456';

let sendResetSpy: jest.SpyInstance;

beforeEach(async () => {
  sendResetSpy = jest
    .spyOn(mailer, 'sendPasswordResetEmail')
    .mockResolvedValue(undefined);

  const company = await prisma.company.create({
    data: { name: 'Reset Co', slug: 'reset-co' },
  });
  await prisma.user.create({
    data: {
      companyId: company.id,
      email: EMAIL,
      fullName: 'Reset Me',
      passwordHash: await hashPassword(OLD_PASSWORD),
      role: 'OWNER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function forgot(email = EMAIL) {
  return request(app).post('/api/v1/auth/forgot-password').send({ email });
}

function reset(body: Record<string, unknown>) {
  return request(app).post('/api/v1/auth/reset-password').send(body);
}

function login(password: string, email = EMAIL) {
  return request(app).post('/api/v1/auth/login').send({ email, password });
}

/** Pull the raw token out of the reset URL the mailer was handed. */
function lastEmailedToken(): string {
  const calls = sendResetSpy.mock.calls;
  if (calls.length === 0) throw new Error('no reset email was sent');
  const url = calls[calls.length - 1][0].resetUrl as string;
  const token = new URL(url).searchParams.get('token');
  if (!token) throw new Error(`no token in reset URL: ${url}`);
  return token;
}

/** Ask for a link and hand back the raw token from the email. */
async function requestToken(): Promise<string> {
  const res = await forgot();
  expect(res.status).toBe(200);
  return lastEmailedToken();
}

describe('POST /auth/forgot-password', () => {
  it('emails a reset link and stores only its hash', async () => {
    const token = await requestToken();

    const rows = await prisma.passwordResetToken.findMany();
    expect(rows).toHaveLength(1);
    // The raw token must not be recoverable from the database.
    expect(rows[0].tokenHash).not.toBe(token);
    expect(rows[0].tokenHash).toBe(hashToken(token));
    expect(rows[0].consumedAt).toBeNull();
    expect(rows[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('answers identically for an unknown email and sends nothing', async () => {
    const known = await forgot();
    sendResetSpy.mockClear();
    const unknown = await forgot('nobody@example.com');

    expect(unknown.status).toBe(known.status);
    expect(unknown.body.message).toBe(known.body.message);
    expect(sendResetSpy).not.toHaveBeenCalled();
    expect(await prisma.passwordResetToken.count()).toBe(1);
  });

  it('sends no link to a disabled account', async () => {
    await prisma.user.updateMany({
      where: { email: EMAIL },
      data: { status: 'DISABLED' },
    });
    const res = await forgot();
    expect(res.status).toBe(200);
    expect(sendResetSpy).not.toHaveBeenCalled();
  });

  it('honours the resend cooldown without breaking the outstanding link', async () => {
    const first = await requestToken();
    sendResetSpy.mockClear();

    const second = await forgot();
    expect(second.status).toBe(200);
    expect(sendResetSpy).not.toHaveBeenCalled();

    // The user is not locked out: the link they already have still works.
    expect((await reset({
      token: first,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    })).status).toBe(200);
  });

  it('a fresh request past the cooldown invalidates the previous link', async () => {
    const first = await requestToken();
    // Age the row past the cooldown window.
    await prisma.passwordResetToken.updateMany({
      data: { createdAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    const second = await requestToken();
    expect(second).not.toBe(first);
    expect(await prisma.passwordResetToken.count()).toBe(1);

    const stale = await reset({
      token: first,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    expect(stale.status).toBe(400);
  });
});

describe('POST /auth/reset-password', () => {
  it('sets the new password and retires the old one', async () => {
    const token = await requestToken();

    const res = await reset({
      token,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(200);
    // No session is handed out — the user proves the new password by signing in.
    expect(res.body.data).toBeNull();

    expect((await login(NEW_PASSWORD)).status).toBe(200);
    expect((await login(OLD_PASSWORD)).status).toBe(401);
  });

  it('marks the token consumed and refuses a second use', async () => {
    const token = await requestToken();
    await reset({
      token,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    const row = await prisma.passwordResetToken.findFirst();
    expect(row!.consumedAt).not.toBeNull();

    const replay = await reset({
      token,
      password: 'YetAnotherPass789',
      confirmPassword: 'YetAnotherPass789',
    });
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe('RESET_TOKEN_INVALID');
    // The replay changed nothing.
    expect((await login(NEW_PASSWORD)).status).toBe(200);
  });

  it('rejects an expired token', async () => {
    const token = await requestToken();
    await prisma.passwordResetToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await reset({
      token,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RESET_TOKEN_INVALID');
    expect((await login(OLD_PASSWORD)).status).toBe(200);
  });

  it('rejects a token that was never issued', async () => {
    await requestToken();
    const res = await reset({
      token: 'x'.repeat(43),
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RESET_TOKEN_INVALID');
  });

  it('gives the same error for wrong, expired and reused tokens', async () => {
    const token = await requestToken();
    await reset({
      token,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    const reused = await reset({
      token,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    const wrong = await reset({
      token: 'y'.repeat(43),
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    expect(reused.body.message).toBe(wrong.body.message);
    expect(reused.body.code).toBe(wrong.body.code);
  });

  it('rejects a mismatched confirmation', async () => {
    const token = await requestToken();
    const res = await reset({
      token,
      password: NEW_PASSWORD,
      confirmPassword: 'SomethingElse123',
    });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'confirmPassword' }),
      ]),
    );
    // The token survives a validation failure so the user can simply retype.
    expect((await prisma.passwordResetToken.findFirst())!.consumedAt).toBeNull();
  });

  it('enforces the shared password policy', async () => {
    const token = await requestToken();
    const res = await reset({
      token,
      password: 'weak',
      confirmPassword: 'weak',
    });
    expect(res.status).toBe(400);
    expect(res.body.errors.length).toBeGreaterThan(0);
    expect((await login(OLD_PASSWORD)).status).toBe(200);
  });

  it('invalidates every existing session', async () => {
    // Two live sessions, as if the account were signed in on a phone and a laptop.
    const phone = await login(OLD_PASSWORD);
    const laptop = await login(OLD_PASSWORD);
    const phoneRefresh = phone.body.data.refreshToken as string;
    const laptopRefresh = laptop.body.data.refreshToken as string;
    expect(
      await prisma.refreshToken.count({ where: { revokedAt: null } }),
    ).toBe(2);

    const token = await requestToken();
    await reset({
      token,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    expect(
      await prisma.refreshToken.count({ where: { revokedAt: null } }),
    ).toBe(0);

    for (const refreshToken of [phoneRefresh, laptopRefresh]) {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });
      expect(res.status).toBe(401);
    }
  });

  it('verifies an unverified account, so a reset cannot dead-end', async () => {
    await prisma.user.updateMany({
      where: { email: EMAIL },
      data: { emailVerifiedAt: null },
    });

    const token = await requestToken();
    await reset({
      token,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    const user = await prisma.user.findUnique({ where: { email: EMAIL } });
    expect(user!.emailVerifiedAt).not.toBeNull();
    // Login is no longer blocked by EMAIL_NOT_VERIFIED.
    expect((await login(NEW_PASSWORD)).status).toBe(200);
  });

  it('refuses to reset a disabled account', async () => {
    const token = await requestToken();
    await prisma.user.updateMany({
      where: { email: EMAIL },
      data: { status: 'DISABLED' },
    });

    const res = await reset({
      token,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RESET_TOKEN_INVALID');
  });
});
