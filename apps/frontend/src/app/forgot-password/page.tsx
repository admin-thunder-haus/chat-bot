'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api, ApiClientError } from '@/lib/api';
import { Alert, Button, Card, FieldError, Input, Label } from '@/components/ui';

export default function ForgotPasswordPage() {
  const { user, initializing } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  // Once the request is accepted the form is replaced by the confirmation, so
  // the same address cannot be submitted over and over into the cooldown.
  const [sent, setSent] = useState(false);

  // Already signed in — there is nothing to recover.
  useEffect(() => {
    if (!initializing && user) router.replace('/dashboard');
  }, [user, initializing, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setFieldErrors({});

    if (!email.trim()) {
      setFieldErrors({ email: 'Please enter your email address.' });
      return;
    }

    setLoading(true);
    try {
      await api.forgotPassword({ email: email.trim() });
      // Success is shown regardless of whether the address exists: the backend
      // will not say, and neither will we.
      setSent(true);
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
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
          AI customer support
        </p>
        <h1 className="mt-2 text-xl font-semibold text-slate-900 sm:text-2xl">
          Reset your password
        </h1>

        {sent ? (
          <>
            <p className="mb-6 mt-1 text-sm text-slate-500">
              If an account exists for{' '}
              <span className="font-medium text-slate-900 break-words">
                {email.trim()}
              </span>
              , a reset link is on its way. The link works once and expires in
              an hour.
            </p>

            <Alert
              variant="success"
              message="Check your inbox — and your spam folder if it hasn't arrived in a few minutes."
            />

            <div className="mt-4 space-y-3">
              <Button
                type="button"
                fullWidth
                onClick={() => router.push('/login')}
              >
                Back to sign in
              </Button>
              <Button
                type="button"
                variant="secondary"
                fullWidth
                onClick={() => setSent(false)}
              >
                Use a different email
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-6 mt-1 text-sm text-slate-500">
              Enter the email address you sign in with and we&apos;ll send you a
              link to choose a new password.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {error && <Alert message={error} />}

              <div>
                <Label htmlFor="email" required>
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  invalid={Boolean(fieldErrors.email)}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                  required
                />
                <FieldError message={fieldErrors.email} />
              </div>

              <Button
                type="submit"
                loading={loading}
                loadingLabel="Sending link…"
                fullWidth
              >
                Send reset link
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-slate-500">
              Remembered it?{' '}
              <Link
                href="/login"
                className="font-medium text-slate-900 underline"
              >
                Sign in
              </Link>
            </p>
          </>
        )}
      </Card>
    </main>
  );
}
