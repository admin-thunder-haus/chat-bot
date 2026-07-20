'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ApiClientError } from '@/lib/api';
import {
  Alert,
  Button,
  Card,
  FieldError,
  Input,
  Label,
} from '@/components/ui';

/** Mirrors the backend password policy for immediate client-side feedback. */
function validatePassword(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(pw)) return 'Password must contain an uppercase letter.';
  if (!/[a-z]/.test(pw)) return 'Password must contain a lowercase letter.';
  if (!/[0-9]/.test(pw)) return 'Password must contain a number.';
  return null;
}

export default function RegisterPage() {
  const { register, user, initializing } = useAuth();
  const router = useRouter();

  const [form, setForm] = useState({
    companyName: '',
    fullName: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!initializing && user) router.replace('/dashboard');
  }, [user, initializing, router]);

  function update(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setFieldErrors({});

    const pwError = validatePassword(form.password);
    if (!form.companyName || !form.fullName || !form.email) {
      setError('Please fill in all fields.');
      return;
    }
    if (pwError) {
      setFieldErrors({ password: pwError });
      return;
    }

    setLoading(true);
    try {
      await register(form);
      router.replace('/dashboard');
    } catch (err) {
      if (err instanceof ApiClientError) {
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
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <Card>
        <h1 className="mb-1 text-2xl font-semibold">Create your workspace</h1>
        <p className="mb-6 text-sm text-slate-500">
          You&apos;ll be set up as the company owner.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {error && <Alert message={error} />}

          <div>
            <Label htmlFor="companyName">Company name</Label>
            <Input
              id="companyName"
              value={form.companyName}
              onChange={(e) => update('companyName', e.target.value)}
              required
            />
            <FieldError message={fieldErrors.companyName} />
          </div>

          <div>
            <Label htmlFor="fullName">Full name</Label>
            <Input
              id="fullName"
              value={form.fullName}
              onChange={(e) => update('fullName', e.target.value)}
              autoComplete="name"
              required
            />
            <FieldError message={fieldErrors.fullName} />
          </div>

          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              autoComplete="email"
              required
            />
            <FieldError message={fieldErrors.email} />
          </div>

          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
              autoComplete="new-password"
              required
            />
            <FieldError message={fieldErrors.password} />
            <p className="mt-1 text-xs text-slate-400">
              At least 8 characters, with upper, lower, and a number.
            </p>
          </div>

          <Button type="submit" loading={loading} fullWidth>
            Create workspace
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-slate-900 underline">
            Sign in
          </Link>
        </p>
      </Card>
    </main>
  );
}
