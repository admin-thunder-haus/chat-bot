'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Button, Badge } from '@/components/ui';
import { NavIcon } from './nav-icons';
import { DEV_NAV_SECTIONS, NAV_SECTIONS, isNavItemActive } from './nav';

const ROW_BASE =
  'group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:ring-offset-white';

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Dashboard" className="flex flex-col gap-5">
      {[...NAV_SECTIONS, ...DEV_NAV_SECTIONS].map((section) => (
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
                        ? 'bg-slate-900 font-medium text-white'
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
  const { company, logout } = useAuth();
  return (
    <>
      <div className="shrink-0 border-b border-slate-200 px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Workspace
        </p>
        <p className="truncate text-lg font-semibold text-slate-900">
          {company?.displayName || company?.name}
        </p>
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
