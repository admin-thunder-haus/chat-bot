import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';

// `app/icon.svg` is picked up automatically as the favicon — no <link> needed.
export const metadata: Metadata = {
  title: 'Thunder.AI — Customer Support',
  description:
    'One inbox for WhatsApp, Instagram, Messenger, Telegram and your website, answered by AI.',
};

// Separate from `metadata`: Next 14 moved themeColor here and warns on every
// route if it is left in the metadata export.
export const viewport: Viewport = {
  themeColor: '#0B72C4',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
