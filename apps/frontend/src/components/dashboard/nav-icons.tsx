import type { ReactElement } from 'react';

/**
 * Sidebar icon set. Hand-rolled inline SVG (no icon dependency): 24x24 viewBox,
 * `stroke="currentColor"`, `fill="none"`, 1.5 stroke — so every glyph inherits
 * the row's text colour and stays crisp at 17px.
 */
export type NavIconName =
  | 'overview'
  | 'inbox'
  | 'analytics'
  | 'operations'
  | 'services'
  | 'products'
  | 'businessHours'
  | 'faqs'
  | 'knowledgeBase'
  | 'aiSettings'
  | 'aiPlayground'
  | 'channels'
  | 'integrations'
  | 'company'
  | 'billing'
  | 'beaker';

const NAV_ICON_PATHS: Record<NavIconName, ReactElement> = {
  // Grid — Overview
  overview: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  // Tray — Inbox
  inbox: (
    <>
      <path d="M5.2 4.5h13.6l2.2 9v4.2a1.8 1.8 0 0 1-1.8 1.8H4.8A1.8 1.8 0 0 1 3 17.7v-4.2l2.2-9Z" />
      <path d="M3 13.5h4.2l1.4 2.3h6.8l1.4-2.3H21" />
    </>
  ),
  // Bar chart — Analytics
  analytics: (
    <>
      <path d="M3 20.5h18" />
      <path d="M6.5 20.5V11" />
      <path d="M12 20.5V4.5" />
      <path d="M17.5 20.5v-6" />
    </>
  ),
  // Clipboard with a checklist — Operations
  operations: (
    <>
      <path d="M9 3.5h6v2.4H9z" />
      <path d="M15 4.7h2.3A1.7 1.7 0 0 1 19 6.4v12.9a1.7 1.7 0 0 1-1.7 1.7H6.7A1.7 1.7 0 0 1 5 19.3V6.4a1.7 1.7 0 0 1 1.7-1.7H9" />
      <path d="M8.5 11.6l1.6 1.6 3.4-3.4" />
      <path d="M8.5 17h7" />
    </>
  ),
  // Receipt — Services
  services: (
    <>
      <path d="M5.5 3.5h13v17l-2.6-1.4-2.6 1.4-2.6-1.4-2.6 1.4-2.6-1.4V3.5Z" />
      <path d="M8.6 8.2h6.8" />
      <path d="M8.6 12.2h6.8" />
    </>
  ),
  // Box — Products
  products: (
    <>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" />
      <path d="M3.5 7.5 12 12l8.5-4.5" />
      <path d="M12 12v9" />
    </>
  ),
  // Clock — Business Hours
  businessHours: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2V12l3.2 2" />
    </>
  ),
  // Question in a circle — FAQs
  faqs: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.5a2.5 2.5 0 1 1 3.7 2.3c-.8.5-1.3 1-1.3 2" />
      <path d="M12 16.8h.01" />
    </>
  ),
  // Open book — Knowledge Base
  knowledgeBase: (
    <>
      <path d="M4 4.8A1.5 1.5 0 0 1 5.5 3.3H10a2.5 2.5 0 0 1 2 1.1v15.9a2.5 2.5 0 0 0-2-1.1H5.5A1.5 1.5 0 0 1 4 17.7V4.8Z" />
      <path d="M20 4.8a1.5 1.5 0 0 0-1.5-1.5H14a2.5 2.5 0 0 0-2 1.1v15.9a2.5 2.5 0 0 1 2-1.1h4.5a1.5 1.5 0 0 0 1.5-1.5V4.8Z" />
    </>
  ),
  // Sliders — AI Settings
  aiSettings: (
    <>
      <path d="M4 6.5h16" />
      <path d="M4 12h16" />
      <path d="M4 17.5h16" />
      <circle cx="9.5" cy="6.5" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="8" cy="17.5" r="2" />
    </>
  ),
  // Sparkles — AI Playground
  aiPlayground: (
    <>
      <path d="M10.5 3.2l1.7 4.4 4.4 1.7-4.4 1.7-1.7 4.4-1.7-4.4L4.4 9.3l4.4-1.7 1.7-4.4Z" />
      <path d="M17.8 14.6l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3Z" />
    </>
  ),
  // Plug — Channels
  channels: (
    <>
      <path d="M9 3v5.5" />
      <path d="M15 3v5.5" />
      <path d="M6 8.5h12v2.2a6 6 0 0 1-12 0V8.5Z" />
      <path d="M12 16.9V21" />
    </>
  ),
  // Puzzle piece — Integrations
  integrations: (
    <path d="M14.5 4.6a2.5 2.5 0 0 0-5 0V6H7a1.5 1.5 0 0 0-1.5 1.5V10H4.2a2.5 2.5 0 0 0 0 5h1.3v2.5A1.5 1.5 0 0 0 7 19h2.5v-1.4a2.5 2.5 0 0 1 5 0V19H17a1.5 1.5 0 0 0 1.5-1.5V15h1.3a2.5 2.5 0 0 0 0-5h-1.3V7.5A1.5 1.5 0 0 0 17 6h-2.5V4.6Z" />
  ),
  // Office building — Company Profile
  company: (
    <>
      <path d="M4 20.5V5a1.8 1.8 0 0 1 1.8-1.8h7A1.8 1.8 0 0 1 14.6 5v15.5" />
      <path d="M14.6 9.5h3.6A1.8 1.8 0 0 1 20 11.3v9.2" />
      <path d="M2.5 20.5h19" />
      <path d="M7.6 7.5h3.4" />
      <path d="M7.6 11.5h3.4" />
      <path d="M7.6 15.5h3.4" />
    </>
  ),
  // Credit card — Billing
  billing: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 10h19" />
      <path d="M6.5 14.5h3.5" />
    </>
  ),
  // Beaker — dev-only tools
  beaker: (
    <>
      <path d="M9 3.2h6" />
      <path d="M10 3.2v5.6l-4.4 8.4A2 2 0 0 0 7.4 20.2h9.2a2 2 0 0 0 1.8-3L14 8.8V3.2" />
      <path d="M7.4 14.4h9.2" />
    </>
  ),
};

export function NavIcon({
  name,
  size = 17,
  className = '',
}: {
  name: NavIconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      {NAV_ICON_PATHS[name]}
    </svg>
  );
}
