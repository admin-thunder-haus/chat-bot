import type { NavIconName } from './nav-icons';
import type { PlatformFeatures } from '@/lib/types';

export interface NavItem {
  label: string;
  href: string;
  icon: NavIconName;
  /**
   * Platform feature this entry depends on. When the backend reports the
   * feature as off, the row is hidden (and its page redirects), so the nav can
   * never link to an endpoint the API refuses to serve.
   */
  requires?: keyof PlatformFeatures;
}

export interface NavSection {
  /** Uppercase group header shown above the rows. */
  title: string;
  items: NavItem[];
}

/** Sidebar navigation for the dashboard, grouped by job-to-be-done. */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Workspace',
    items: [
      { label: 'Overview', href: '/dashboard', icon: 'overview' },
      { label: 'Inbox', href: '/dashboard/inbox', icon: 'inbox' },
      { label: 'Analytics', href: '/dashboard/analytics', icon: 'analytics' },
      { label: 'Operations', href: '/dashboard/operations', icon: 'operations' },
    ],
  },
  {
    title: 'Catalog',
    items: [
      { label: 'Services', href: '/dashboard/services', icon: 'services' },
      { label: 'Products', href: '/dashboard/products', icon: 'products' },
      {
        label: 'Business Hours',
        href: '/dashboard/business-hours',
        icon: 'businessHours',
      },
    ],
  },
  {
    title: 'Knowledge',
    items: [
      { label: 'FAQs', href: '/dashboard/faqs', icon: 'faqs' },
      {
        label: 'Knowledge Base',
        href: '/dashboard/knowledge-base',
        icon: 'knowledgeBase',
      },
    ],
  },
  {
    title: 'AI',
    items: [
      { label: 'AI Settings', href: '/dashboard/ai-settings', icon: 'aiSettings' },
      {
        label: 'AI Playground',
        href: '/dashboard/ai-playground',
        icon: 'aiPlayground',
      },
    ],
  },
  {
    title: 'Setup',
    items: [
      { label: 'Channels', href: '/dashboard/channels', icon: 'channels' },
      {
        label: 'Integrations',
        href: '/dashboard/integrations',
        icon: 'integrations',
      },
      { label: 'Company Profile', href: '/dashboard/profile', icon: 'company' },
      {
        label: 'Billing',
        href: '/dashboard/billing',
        icon: 'billing',
        requires: 'billing',
      },
    ],
  },
];

/** Development-only navigation (hidden in production builds). */
export const DEV_NAV_SECTIONS: NavSection[] =
  process.env.NODE_ENV === 'production'
    ? []
    : [
        {
          title: 'Dev',
          items: [
            {
              label: 'Mock Message',
              href: '/dashboard/dev/mock-message',
              icon: 'beaker',
            },
          ],
        },
      ];

/**
 * Drop entries whose required platform feature is switched off, then drop any
 * section left empty. Returns the input untouched when nothing is gated, so
 * the common case allocates one shallow copy and no more.
 */
export function visibleNavSections(
  sections: NavSection[],
  features: PlatformFeatures,
): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.requires || features[item.requires],
      ),
    }))
    .filter((section) => section.items.length > 0);
}

/** Flattened views (kept for callers that only need the raw item list). */
export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);
export const DEV_NAV_ITEMS: NavItem[] = DEV_NAV_SECTIONS.flatMap((s) => s.items);

/**
 * Active-state matching. `/dashboard` is exact-only (otherwise Overview would
 * light up everywhere); every other entry also matches its nested routes, so
 * `/dashboard/channels/webchat/xyz` still highlights Channels.
 */
export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}
