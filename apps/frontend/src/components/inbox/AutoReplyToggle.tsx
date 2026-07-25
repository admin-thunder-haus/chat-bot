'use client';

import { Toggle } from '@/components/ui';
import type { AIConversationMode } from '@/lib/types';

/**
 * One-click "AI auto-reply" control for the open conversation.
 *
 * The AI answers automatically only when BOTH gates are open: the company opted
 * in AND this conversation is not paused. Turning it ON may need the
 * company-wide flag (OWNER/ADMIN only); turning it OFF pauses THIS conversation
 * only, which any writable role may do.
 *
 * Rendered in the conversation header at `lg+` and in the composer toolbar below
 * `lg`, so exactly one instance is visible at a time.
 */
export function AutoReplyToggle({
  aiMode,
  companyAutoReplyEnabled,
  canManageCompanyAI,
  writable,
  busy,
  onToggle,
  className = '',
}: {
  aiMode: AIConversationMode;
  /** Company-wide auto-reply flag; null while the AI settings are loading. */
  companyAutoReplyEnabled: boolean | null;
  /** OWNER/ADMIN — only they may flip the company-wide flag. */
  canManageCompanyAI: boolean;
  writable: boolean;
  busy: boolean;
  onToggle: (next: boolean) => void;
  className?: string;
}) {
  const on = companyAutoReplyEnabled === true && aiMode === 'ENABLED';
  const needsCompanyFlag = companyAutoReplyEnabled !== true;
  const disabled =
    busy ||
    companyAutoReplyEnabled === null ||
    (!on && needsCompanyFlag && !canManageCompanyAI) ||
    (!on && !writable);

  const hint = on
    ? 'The AI answers new customer messages in this conversation instantly. Turning this off pauses the AI here only.'
    : companyAutoReplyEnabled === null
      ? 'Loading AI settings…'
      : needsCompanyFlag && !canManageCompanyAI
        ? 'Auto-reply is off for your company. Ask an owner or admin to enable it.'
        : needsCompanyFlag
          ? 'Turn on to let the AI answer instantly. This also enables auto-reply for your company.'
          : !writable
            ? 'Only an owner or admin can resume the AI for this conversation.'
            : 'Turn on to let the AI answer new messages in this conversation instantly.';

  return (
    <span
      title={hint}
      className={`inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1 ${className}`}
    >
      <span className="text-xs font-medium text-slate-600">AI auto-reply</span>
      <Toggle
        checked={on}
        disabled={disabled}
        label="AI auto-reply"
        onChange={onToggle}
      />
      {/* Never state by colour alone (§3) — the on/off word carries the state. */}
      <span className="text-xs font-medium tabular-nums text-slate-500">
        {on ? 'On' : 'Off'}
      </span>
    </span>
  );
}
