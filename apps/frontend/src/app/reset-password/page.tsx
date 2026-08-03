'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api, ApiClientError } from '@/lib/api';
import { Alert, Button, Card, FieldError, Input, Label } from '@/components/ui';
import { Logo } from '@/components/Logo';

/** Mirrors the backend password policy so the user is told before submitting. */
function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Z]/.test(password)) return 'Include an uppercase letter.';
  if (!/[a-z]/.test(password)) return 'Include a lowercase letter.';
  if (!/[0-9]/.test(password)) return 'Include a number.';
  return null;
}

function ResetPasswordForm() {
  const { user, initializing } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // Already signed in — nothing to reset from here.
  useEffect(() => {
    if (!initializing && user) router.replace('/dashboard');
  }, [user, initializing, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setFieldErrors({});

    const problem = passwordProblem(password);
    if (problem) {
      setFieldErrors({ password: problem });
      return;
    }
    if (password !== confirmPassword) {
      setFieldErrors({ confirmPassword: 'The two passwords do not match.' });
      return;
    }

    setLoading(true);
    try {
      await api.resetPassword({ token, password, confirmPassword });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
        const fields: Record<string, string> = {};
        for (const detail of err.errors) {
          if (detail.field) fields[detail.field] = detail.message;
        }
        setFieldErrors(fields);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <Card>
        <Logo className="text-slate-900" markClassName="h-7 w-7" textClassName="text-sm" />
        <h1 className="mt-2 text-xl font-semibold text-slate-900 sm:text-2xl">
          Choose a new password
        </h1>

        {/* No token in the URL at all — the link was truncated or hand-typed. */}
        {!token ? (
          <>
            <p className="mb-6 mt-1 text-sm text-slate-500">
              This page needs the link from your reset email.
            </p>
            <Alert message="This password reset link is incomplete. Request a new one and open it directly from your email." />
            <div className="mt-4">
              <Button
                type="button"
                fullWidth
                onClick={() => router.push('/forgot-password')}
              >
                Request a new link
              </Button>
            </div>
          </>
        ) : done ? (
          <>
            <p className="mb-6 mt-1 text-sm text-slate-500">
              Your password has been changed and every other device has been
              signed out.
            </p>
            <Alert
              variant="success"
              message="Password updated. Sign in with your new password to continue."
            />
            <div className="mt-4">
              <Button
                type="button"
                fullWidth
                onClick={() => router.replace('/login')}
              >
                Sign in
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-6 mt-1 text-sm text-slate-500">
              Pick a password you haven&apos;t used before. Signing in again
              afterwards will confirm it worked.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {error && <Alert message={error} />}

              <div>
                <Label htmlFor="password" required>
                  New password
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  invalid={Boolean(fieldErrors.password)}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  autoFocus
                  required
                />
                <FieldError message={fieldErrors.password} />
                <p className="mt-1 text-xs text-slate-500">
                  At least 8 characters, with an uppercase letter, a lowercase
                  letter and a number.
                </p>
              </div>

              <div>
                <Label htmlFor="confirmPassword" required>
                  Confirm new password
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  invalid={Boolean(fieldErrors.confirmPassword)}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
                <FieldError message={fieldErrors.confirmPassword} />
              </div>

              <Button
                type="submit"
                loading={loading}
                loadingLabel="Saving password…"
                fullWidth
              >
                Save new password
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-slate-500">
              Link expired?{' '}
              <Link
                href="/forgot-password"
                className="font-medium text-slate-900 underline"
              >
                Request a new one
              </Link>
            </p>
          </>
        )}
      </Card>
    </main>
  );
}

export default function ResetPasswordPage() {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
