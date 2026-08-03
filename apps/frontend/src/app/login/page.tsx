'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ApiClientError } from '@/lib/api';
import { Alert, Button, Card, FieldError, Input, Label } from '@/components/ui';
import { Logo } from '@/components/Logo';

export default function LoginPage() {
  const { login, user, initializing } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  // Redirect away if already authenticated.
  useEffect(() => {
    if (!initializing && user) router.replace('/dashboard');
  }, [user, initializing, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setFieldErrors({});

    if (!email || !password) {
      setError('Please enter your email and password.');
      return;
    }

    setLoading(true);
    try {
      await login(email, password);
      router.replace('/dashboard');
    } catch (err) {
      if (err instanceof ApiClientError) {
        // Unverified accounts are routed to the verification step.
        if (err.code === 'EMAIL_NOT_VERIFIED') {
          router.replace(`/verify-email?email=${encodeURIComponent(email)}`);
          return;
        }
        setError(err.message);
        const fields: Record<string, string> = {};
        for (const e2 of err.errors) {
          if (e2.field) fields[e2.field] = e2.message;
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
          Welcome back
        </h1>
        <p className="mb-6 mt-1 text-sm text-slate-500">
          Sign in to your workspace to reach your inbox and settings.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {error && <Alert message={error} />}

          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              invalid={Boolean(fieldErrors.email)}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            <FieldError message={fieldErrors.email} />
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="mb-1 text-sm font-medium text-slate-500 underline hover:text-slate-900"
              >
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              value={password}
              invalid={Boolean(fieldErrors.password)}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <FieldError message={fieldErrors.password} />
          </div>

          <Button
            type="submit"
            loading={loading}
            loadingLabel="Signing in…"
            fullWidth
          >
            Sign in
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          Don&apos;t have an account?{' '}
          <Link
            href="/register"
            className="font-medium text-slate-900 underline"
          >
            Register a company
          </Link>
        </p>
      </Card>
    </main>
  );
}
