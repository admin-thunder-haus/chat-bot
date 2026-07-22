export interface NavItem {
  label: string;
  href: string;
  icon: string;
}

/** Sidebar navigation for the dashboard. */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', href: '/dashboard', icon: '▤' },
  { label: 'Inbox', href: '/dashboard/inbox', icon: '📥' },
  { label: 'Channels', href: '/dashboard/channels', icon: '🔌' },
  { label: 'Company Profile', href: '/dashboard/profile', icon: '🏢' },
  { label: 'Services', href: '/dashboard/services', icon: '🧾' },
  { label: 'Products', href: '/dashboard/products', icon: '📦' },
  { label: 'Business Hours', href: '/dashboard/business-hours', icon: '🕒' },
  { label: 'FAQs', href: '/dashboard/faqs', icon: '❓' },
  { label: 'Knowledge Base', href: '/dashboard/knowledge-base', icon: '📚' },
  { label: 'AI Settings', href: '/dashboard/ai-settings', icon: '🤖' },
  { label: 'AI Playground', href: '/dashboard/ai-playground', icon: '✨' },
];

/** Development-only navigation (hidden in production builds). */
export const DEV_NAV_ITEMS: NavItem[] =
  process.env.NODE_ENV === 'production'
    ? []
    : [{ label: 'Mock Message', href: '/dashboard/dev/mock-message', icon: '🧪' }];
