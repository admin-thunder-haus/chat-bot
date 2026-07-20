'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { ChatWidget } from '@/components/widget/ChatWidget';

/**
 * Public, standalone Web Chat page. No dashboard shell, no auth. Two roles:
 *  - `?embed=1`  → panel-only, sized by the host loader's iframe (production).
 *  - direct visit → a full standalone widget (launcher + panel) for testing.
 */
export default function WidgetPage() {
  const params = useParams<{ publicId: string }>();
  const search = useSearchParams();
  const publicId = params?.publicId ?? '';
  const embed = search?.get('embed') === '1';
  const themeParam = search?.get('theme');
  const theme =
    themeParam === 'dark' || themeParam === 'light' ? themeParam : 'auto';

  if (!publicId) return null;

  if (embed) {
    return (
      <div style={{ position: 'fixed', inset: 0 }}>
        <ChatWidget publicId={publicId} mode="panel" theme={theme} />
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(1200px 600px at 50% -10%, #e2e8f0, #f8fafc)',
        color: '#334155',
        fontFamily: 'system-ui, sans-serif',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>Web Chat preview</h1>
        <p style={{ marginTop: 8, fontSize: 14, color: '#64748b' }}>
          This is a live standalone preview of your widget. Use the launcher in
          the corner to start chatting.
        </p>
      </div>
      <ChatWidget publicId={publicId} mode="standalone" theme={theme} startOpen />
    </div>
  );
}
