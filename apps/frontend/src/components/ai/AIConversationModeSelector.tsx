'use client';

import { Badge, Select } from '@/components/ui';
import type { AIConversationMode } from '@/lib/types';

const MODE_COLOR: Record<AIConversationMode, 'green' | 'amber' | 'slate'> = {
  ENABLED: 'green',
  PAUSED: 'amber',
  HUMAN_ONLY: 'slate',
};

const MODE_LABEL: Record<AIConversationMode, string> = {
  ENABLED: 'AI Enabled',
  PAUSED: 'AI Paused',
  HUMAN_ONLY: 'Human Only',
};

export function AIConversationModeSelector({
  mode,
  canResume,
  busy,
  onChange,
}: {
  mode: AIConversationMode;
  canResume: boolean;
  busy: boolean;
  onChange: (mode: AIConversationMode) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Badge color={MODE_COLOR[mode]}>{MODE_LABEL[mode]}</Badge>
      <Select
        aria-label="AI mode"
        value={mode}
        disabled={busy}
        onChange={(e) => onChange(e.target.value as AIConversationMode)}
        className="w-auto text-xs"
      >
        {/* Resuming to ENABLED is OWNER/ADMIN only. */}
        <option value="ENABLED" disabled={mode !== 'ENABLED' && !canResume}>
          AI Enabled
        </option>
        <option value="PAUSED">AI Paused</option>
        <option value="HUMAN_ONLY">Human Only</option>
      </Select>
    </div>
  );
}
