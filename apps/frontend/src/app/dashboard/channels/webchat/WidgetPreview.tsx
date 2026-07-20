'use client';

import type { WebChatConfig } from '@/lib/types';

/**
 * Static, presentational preview of the Web Chat widget for the config page.
 * Reflects config + theme instantly with NO backend calls (so tweaking the
 * config never creates demo conversations). The real, live widget is one click
 * away via the "Open live preview" link on the config page.
 */
export function WidgetPreview({
  config,
  dark,
}: {
  config: WebChatConfig;
  dark: boolean;
}) {
  const c = dark
    ? { bg: '#0b1220', text: '#e2e8f0', muted: '#94a3b8', border: '#1e293b', agent: '#1e293b' }
    : { bg: '#ffffff', text: '#0f172a', muted: '#64748b', border: '#e2e8f0', agent: '#f1f5f9' };
  const accent = config.themeColor;

  return (
    <div
      className="mx-auto flex flex-col overflow-hidden rounded-2xl shadow-xl"
      style={{ width: 340, height: 460, background: c.bg, color: c.text }}
      aria-label="Widget preview"
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ background: accent, color: '#fff' }}
      >
        <div>
          <p className="text-sm font-semibold">{config.title}</p>
          <p className="text-[11px] opacity-80">We typically reply quickly</p>
        </div>
        <span aria-hidden="true">✕</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        <Row side="left">
          <p className="mb-0.5 text-[10px] font-semibold" style={{ color: c.muted }}>
            {config.assistantLabel}
          </p>
          <Bubble style={{ background: c.agent, color: c.text }}>
            {config.welcomeMessage}
          </Bubble>
        </Row>
        <Row side="right">
          <Bubble style={{ background: accent, color: '#fff' }}>
            Hi! Do you offer refunds?
          </Bubble>
        </Row>
        <Row side="left">
          <p className="mb-0.5 text-[10px] font-semibold" style={{ color: c.muted }}>
            {config.agentLabel}
          </p>
          <Bubble style={{ background: c.agent, color: c.text }}>
            Yes — within 14 days of purchase. 😊
          </Bubble>
        </Row>
      </div>
      <div className="flex items-center gap-2 border-t px-3 py-2" style={{ borderColor: c.border }}>
        <div
          className="flex-1 rounded-lg px-3 py-2 text-sm"
          style={{ border: `1px solid ${c.border}`, color: c.muted }}
        >
          Type your message…
        </div>
        <div
          className="rounded-lg px-3 py-2 text-sm font-medium text-white"
          style={{ background: accent }}
        >
          Send
        </div>
      </div>
    </div>
  );
}

function Row({ side, children }: { side: 'left' | 'right'; children: React.ReactNode }) {
  return (
    <div className={`flex ${side === 'right' ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[82%]">{children}</div>
    </div>
  );
}

function Bubble({
  children,
  style,
}: {
  children: React.ReactNode;
  style: React.CSSProperties;
}) {
  return (
    <div className="rounded-2xl px-3 py-2 text-sm" style={style}>
      {children}
    </div>
  );
}
