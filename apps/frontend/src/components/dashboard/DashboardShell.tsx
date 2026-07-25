'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui';
import { Sidebar } from './Sidebar';
import { NotificationsBell } from './NotificationsBell';

function MenuIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const { company, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever the route changes (covers in-drawer navigation
  // as well as browser back/forward).
  useEffect(() => setMobileOpen(false), [pathname]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Sidebar (static, large screens) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <Sidebar />
      </aside>

      {/* Sidebar (drawer, small screens) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-64 max-w-[80%] flex-col border-r border-slate-200 bg-white shadow-xl"
          >
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="lg:pl-64">
        {/* Header */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              className="rounded-md p-2 text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 lg:hidden"
            >
              <MenuIcon />
            </button>
            <span className="font-semibold text-slate-900">
              {company?.displayName || company?.name}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <NotificationsBell />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void logout()}
              className="lg:hidden"
            >
              Log out
            </Button>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
