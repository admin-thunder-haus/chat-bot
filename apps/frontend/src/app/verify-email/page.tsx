'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api, ApiClientError } from '@/lib/api';
import {
  Alert,
  Button,
  Card,
  FieldError,
  Input,
  Label,
} from '@/components/ui';

const RESEND_COOLDOWN_SECONDS = 60;

function VerifyEmailForm() {
  const { verifyEmail, user, initializing } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Already signed in — nothing to verify here.
  useEffect(() => {
    if (!initializing && user) router.replace('/dashboard');
  }, [user, initializing, router]);

  // Tick the resend cooldown down once per second.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    setFieldErrors({});

    if (!email) {
      setFieldErrors({ email: 'Please enter your email address.' });
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setFieldErrors({ code: 'Enter the 6-digit code from your email.' });
      return;
    }

    setLoading(true);
    try {
      await verifyEmail(email, code.trim());
      router.replace('/dashboard');
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === 'EMAIL_ALREADY_VERIFIED') {
          router.replace('/login');
          return;
        }
        setError(err.message);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (cooldown > 0 || resending) return;
    setError('');
    setInfo('');

    if (!email) {
      setFieldErrors({ email: 'Please enter your email address.' });
      return;
    }

    setResending(true);
    try {
      await api.resendVerification({ email });
      setInfo('If this email is registered and unverified, a new code is on its way.');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Could not resend the code. Please try again.',
      );
    } finally {
      setResending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <Card>
        <h1 className="mb-1 text-2xl font-semibold">Verify your email</h1>
        <p className="mb-6 text-sm text-slate-500">
          We sent a 6-digit code to your email address. Enter it below to
          activate your account.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {error && <Alert message={error} />}
          {info && <Alert variant="success" message={info} />}

          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            <FieldError message={fieldErrors.email} />
          </div>

          <div>
            <Label htmlFor="code">Verification code</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
            />
            <FieldError message={fieldErrors.code} />
          </div>

          <Button type="submit" loading={loading} fullWidth>
            Verify and continue
          </Button>
        </form>

        <div className="mt-4 text-center text-sm text-slate-500">
          Didn&apos;t receive it?{' '}
          <button
            type="button"
            onClick={handleResend}
            disabled={cooldown > 0 || resending}
            className="font-medium text-slate-900 underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
          >
            {cooldown > 0 ? `Resend code (${cooldown}s)` : 'Resend code'}
          </button>
        </div>

        <p className="mt-6 text-center text-sm text-slate-500">
          Back to{' '}
          <Link href="/login" className="font-medium text-slate-900 underline">
            Sign in
          </Link>
        </p>
      </Card>
    </main>
  );
}

export default function VerifyEmailPage() {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <VerifyEmailForm />
    </Suspense>
  );
}
