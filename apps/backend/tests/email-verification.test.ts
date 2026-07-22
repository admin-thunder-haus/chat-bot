import request from 'supertest';
import { createApp } from '../src/app';
import { mailer } from '../src/utils/mailer';
import { prisma } from './setup';

/**
 * Deep coverage of the email verification lifecycle: expiration, attempt
 * limits, and resend (cooldown, rotation, enumeration safety). The happy path
 * and login gating live in auth.test.ts.
 */

const app = createApp();

const validRegister = {
  companyName: 'Verify Co',
  fullName: 'Vera Fication',
  email: 'vera@example.com',
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

function lastEmailedCode(): string {
  const calls = sendVerificationSpy.mock.calls;
  if (calls.length === 0) throw new Error('no verification email was sent');
  return calls[calls.length - 1][0].code as string;
}

async function register() {
  return request(app).post('/api/v1/auth/register').send(validRegister);
}

function verify(code: string, email = validRegister.email) {
  return request(app).post('/api/v1/auth/verify-email').send({ email, code });
}

function resend(email = validRegister.email) {
  return request(app).post('/api/v1/auth/resend-verification').send({ email });
}

function wrongCode(right: string): string {
  return right === '000000' ? '111111' : '000000';
}

describe('code expiration', () => {
  it('rejects an expired code', async () => {
    await register();
    const code = lastEmailedCode();

    await prisma.emailVerificationCode.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await verify(code);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid or expired verification code');
  });
});

describe('attempt limiting', () => {
  it('locks the code after too many wrong attempts, even for the right code', async () => {
    await register();
    const code = lastEmailedCode();
    const bad = wrongCode(code);

    for (let i = 0; i < 5; i += 1) {
      const res = await verify(bad);
      expect(res.status).toBe(400);
    }

    const res = await verify(code);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Too many incorrect attempts');
  });
});

describe('resend', () => {
  it('is silently skipped inside the cooldown window', async () => {
    await register();
    expect(sendVerificationSpy).toHaveBeenCalledTimes(1);

    const res = await resend();
    expect(res.status).toBe(200);
    // Still only the registration email — cooldown suppressed the resend.
    expect(sendVerificationSpy).toHaveBeenCalledTimes(1);
  });

  it('issues a fresh code after the cooldown and invalidates the old one', async () => {
    await register();
    const oldCode = lastEmailedCode();

    // Age the existing code past the resend cooldown.
    await prisma.emailVerificationCode.updateMany({
      data: { createdAt: new Date(Date.now() - 2 * 60 * 1000) },
    });

    const res = await resend();
    expect(res.status).toBe(200);
    expect(sendVerificationSpy).toHaveBeenCalledTimes(2);
    const newCode = lastEmailedCode();

    // The replaced code no longer works (unless the random codes collide).
    if (oldCode !== newCode) {
      const oldRes = await verify(oldCode);
      expect(oldRes.status).toBe(400);
    }

    const okRes = await verify(newCode);
    expect(okRes.status).toBe(200);
    expect(okRes.body.data.accessToken).toEqual(expect.any(String));
  });

  it('returns the same generic response for unknown emails (no enumeration)', async () => {
    const res = await resend('ghost@example.com');
    expect(res.status).toBe(200);
    expect(sendVerificationSpy).not.toHaveBeenCalled();
  });

  it('does not send to an already-verified account', async () => {
    await register();
    await verify(lastEmailedCode());
    sendVerificationSpy.mockClear();

    const res = await resend();
    expect(res.status).toBe(200);
    expect(sendVerificationSpy).not.toHaveBeenCalled();
  });
});
