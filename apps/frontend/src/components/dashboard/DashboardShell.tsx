'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Button, Badge } from '@/components/ui';
import { NAV_ITEMS, DEV_NAV_ITEMS } from './nav';

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {[...NAV_ITEMS, ...DEV_NAV_ITEMS].map((item) => {
        const active =
          item.href === '/dashboard'
            ? pathname === '/dashboard'
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              active
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function UserSummary() {
  const { user, company } = useAuth();
  if (!user || !company) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="truncate text-sm font-medium text-slate-900">
        {user.fullName}
      </p>
      <p className="truncate text-xs text-slate-500">{user.email}</p>
      <div className="mt-2">
        <Badge color="blue">{user.role}</Badge>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const { company, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-200 bg-white p-4 lg:flex">
        <div className="mb-6 px-2">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Workspace
          </p>
          <p className="truncate text-lg font-semibold text-slate-900">
            {company?.displayName || company?.name}
          </p>
        </div>
        <NavLinks />
        <div className="mt-auto flex flex-col gap-3">
          <UserSummary />
          <Button variant="secondary" fullWidth onClick={() => void logout()}>
            Log out
          </Button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-slate-200 bg-white p-4">
            <div className="mb-6 px-2">
              <p className="truncate text-lg font-semibold text-slate-900">
                {company?.displayName || company?.name}
              </p>
            </div>
            <NavLinks onNavigate={() => setMobileOpen(false)} />
            <div className="mt-auto flex flex-col gap-3">
              <UserSummary />
              <Button
                variant="secondary"
                fullWidth
                onClick={() => void logout()}
              >
                Log out
              </Button>
            </div>
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
              className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            >
              ☰
            </button>
            <span className="font-semibold text-slate-900">
              {company?.displayName || company?.name}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void logout()}
            className="lg:hidden"
          >
            Log out
          </Button>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
