'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Button, Badge } from '@/components/ui';
import { Logo } from '@/components/Logo';
import { NavIcon } from './nav-icons';
import {
  DEV_NAV_SECTIONS,
  NAV_SECTIONS,
  isNavItemActive,
  visibleNavSections,
} from './nav';

const ROW_BASE =
  'group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white';

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { features } = useAuth();
  const sections = visibleNavSections(
    [...NAV_SECTIONS, ...DEV_NAV_SECTIONS],
    features,
  );
  return (
    <nav aria-label="Dashboard" className="flex flex-col gap-5">
      {sections.map((section) => (
        <div key={section.title}>
          <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {section.title}
          </p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const active = isNavItemActive(item.href, pathname);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`${ROW_BASE} ${
                      active
                        ? 'bg-brand-600 font-medium text-white'
                        : 'font-normal text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <NavIcon
                      name={item.icon}
                      className={active ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserSummary() {
  const { user } = useAuth();
  if (!user) return null;
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

/**
 * The sidebar column: pinned brand header, independently scrolling nav, pinned
 * user summary + logout. Shared by the static desktop sidebar and the mobile
 * drawer so the two can never drift apart.
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { logout } = useAuth();
  return (
    <>
      {/*
        The mark alone. The workspace name used to sit here too, but it is
        already the first thing in the page header on every screen — repeating
        it inside the sidebar cost two lines of vertical space and told the
        operator nothing they were not already looking at.
      */}
      <div className="shrink-0 border-b border-slate-200 px-5 py-4">
        <Logo
          className="text-slate-900"
          markClassName="h-7 w-7"
          textClassName="text-sm"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-4">
        <SidebarNav onNavigate={onNavigate} />
      </div>

      <div className="shrink-0 border-t border-slate-200 p-3">
        <div className="flex flex-col gap-3">
          <UserSummary />
          <Button variant="secondary" fullWidth onClick={() => void logout()}>
            Log out
          </Button>
        </div>
      </div>
    </>
  );
}
