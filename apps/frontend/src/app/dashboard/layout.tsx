'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ToastProvider } from '@/components/toast';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { Spinner } from '@/components/ui';

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user, initializing } = useAuth();
  const router = useRouter();

  // Protect every /dashboard route once the session check has settled.
  useEffect(() => {
    if (!initializing && !user) router.replace('/login');
  }, [user, initializing, router]);

  if (initializing || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  return (
    <ToastProvider>
      <DashboardShell>{children}</DashboardShell>
    </ToastProvider>
  );
}
