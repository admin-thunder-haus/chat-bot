import request from 'supertest';
import { createApp } from '../src/app';
import { mailer } from '../src/utils/mailer';
import { drainJobs } from './jobs-helpers';
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
  const res = await request(app).post('/api/v1/auth/register').send(validRegister);
  // Auth emails are QUEUED, not sent inline (an SMTP failure must not fail the
  // request that triggered it). Let the queue catch up so the mailer spy sees
  // the send — deterministic, drainJobs never sleeps.
  await drainJobs();
  return res;
}

function verify(code: string, email = validRegister.email) {
  return request(app).post('/api/v1/auth/verify-email').send({ email, code });
}

async function resend(email = validRegister.email) {
  const res = await request(app)
    .post('/api/v1/auth/resend-verification')
    .send({ email });
  // Auth emails are QUEUED, not sent inline (an SMTP failure must not fail the
  // request that triggered it). Let the queue catch up so the mailer spy sees
  // the send — deterministic, drainJobs never sleeps.
  await drainJobs();
  return res;
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

/**
 * Regression: the bug that stranded a real signup in production.
 *
 * Registration used to `await mailer.sendVerificationEmail()` inline, AFTER the
 * company + user were already committed. When SMTP was first configured for real
 * and the relay rejected the send, the request 500'd with the account already in
 * the database. The retry then answered 409 "email already exists" and the user
 * was permanently stuck: unable to register, unable to log in (unverified), and
 * never emailed a code.
 */
describe('a failing mail relay never strands a signup', () => {
  it('registers successfully even when every send fails', async () => {
    sendVerificationSpy.mockRejectedValue(
      new Error('501 Invalid sender: not a verified sender in this account'),
    );

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(validRegister);

    // The user is told to check their email; the account exists and is usable.
    expect(res.status).toBe(201);
    expect(res.body.data.requiresEmailVerification).toBe(true);

    const user = await prisma.user.findUnique({
      where: { email: validRegister.email },
    });
    expect(user).not.toBeNull();
    expect(user!.emailVerifiedAt).toBeNull();
  });

  it('retries the send in the background instead of losing it', async () => {
    sendVerificationSpy.mockRejectedValueOnce(new Error('smtp timeout'));

    await request(app).post('/api/v1/auth/register').send(validRegister);
    await drainJobs();

    // The first attempt failed and the job is QUEUED again, not lost or dead.
    const job = await prisma.job.findFirst({ where: { type: 'email.send' } });
    expect(job!.status).toBe('QUEUED');
    expect(job!.attempts).toBe(1);

    // The retry is deliberately BACKED OFF, so it is not due yet. Rewind runAt
    // rather than sleeping — the delay is the queue's job to prove, not this
    // test's to wait out.
    await prisma.job.update({
      where: { id: job!.id },
      data: { runAt: new Date(Date.now() - 1000) },
    });
    await drainJobs();

    expect(sendVerificationSpy).toHaveBeenCalledTimes(2);
    // The retry replaced the code rather than piling up a second live one.
    expect(await prisma.emailVerificationCode.count()).toBe(1);

    // And the freshly emailed code actually works.
    expect((await verify(lastEmailedCode())).status).toBe(200);
  });

  it('a second registration attempt still reports the email as taken', async () => {
    // Documents the CORRECT behaviour of the 409 the owner hit: it is only
    // wrong when the first attempt lied about failing. Here it did not.
    await register();
    const again = await request(app)
      .post('/api/v1/auth/register')
      .send(validRegister);
    expect(again.status).toBe(409);
  });
});
