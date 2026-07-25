'use client';

import { Badge, Button, Toggle } from '@/components/ui';
import { channelLabel, customerName } from '@/lib/format';
import type {
  AIConversationMode,
  ConversationDetail,
  ConversationPriority,
  ConversationStatus,
  Tag,
  UserSummary,
} from '@/lib/types';
import type { RegenerateAdjustment } from '@/lib/resources';
import { StatusSelector } from './StatusSelector';
import { PrioritySelector } from './PrioritySelector';
import { AssignmentSelector } from './AssignmentSelector';
import { TagSelector } from './TagSelector';
import { AIConversationModeSelector } from '@/components/ai/AIConversationModeSelector';
import { AIAssistantMenu } from '@/components/ai/AIAssistantMenu';

/**
 * Compact conversation header: identity + Details/AI Assistant on top, and all
 * status/priority/assignment/AI-mode/tags controls on one tidy wrapping row.
 */
export function CompactConversationHeader({
  conversation,
  assignableUsers,
  allTags,
  busy,
  writable,
  aiGenerating,
  hasDraft,
  companyAutoReplyEnabled,
  canManageCompanyAI,
  onBack,
  onOpenDetails,
  onStatus,
  onPriority,
  onAssign,
  onAttachTag,
  onDetachTag,
  onArchive,
  onSetMode,
  onToggleAutoReply,
  onDraft,
  onRegenerate,
  onReply,
}: {
  conversation: ConversationDetail;
  assignableUsers: UserSummary[];
  allTags: Tag[];
  busy: boolean;
  writable: boolean;
  aiGenerating: boolean;
  hasDraft: boolean;
  /** Company-wide auto-reply flag; null while the AI settings are loading. */
  companyAutoReplyEnabled: boolean | null;
  /** OWNER/ADMIN — only they may flip the company-wide flag. */
  canManageCompanyAI: boolean;
  onBack: () => void;
  onOpenDetails: () => void;
  onStatus: (s: ConversationStatus) => void;
  onPriority: (p: ConversationPriority) => void;
  onAssign: (userId: string | null) => void;
  onAttachTag: (tagId: string) => void;
  onDetachTag: (tagId: string) => void;
  onArchive: () => void;
  onSetMode: (mode: AIConversationMode) => void;
  onToggleAutoReply: (next: boolean) => void;
  onDraft: () => void;
  onRegenerate: (adjustment: RegenerateAdjustment) => void;
  onReply: () => void;
}) {
  const assigned = conversation.tagAssignments.map((a) => a.tag);

  // The AI answers this conversation automatically only when BOTH gates are
  // open: the company opted in AND this conversation is not paused.
  const autoReplyOn =
    companyAutoReplyEnabled === true && conversation.aiMode === 'ENABLED';
  // Turning it ON may need the company-wide flag, which is OWNER/ADMIN only.
  // Turning it OFF only pauses THIS conversation, which every role may do.
  const needsCompanyFlag = companyAutoReplyEnabled !== true;
  const autoReplyDisabled =
    busy ||
    companyAutoReplyEnabled === null ||
    (!autoReplyOn && needsCompanyFlag && !canManageCompanyAI) ||
    (!autoReplyOn && !writable);
  const autoReplyHint = autoReplyOn
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

  const handedOff =
    Boolean(conversation.handoffRequestedAt) && conversation.aiMode !== 'ENABLED';
  const handoffReasonText =
    conversation.handoffReason === 'customer_request'
      ? 'Customer asked for a human'
      : conversation.handoffReason === 'low_confidence'
        ? "AI couldn't answer"
        : null;

  return (
    <div className="shrink-0 border-b border-slate-200 px-3 py-2">
      {/* Top row: identity + actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="rounded-md p-1 text-slate-500 hover:bg-slate-100 md:hidden"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-slate-900">
            {customerName(conversation.customer)}
          </h2>
          <p className="truncate text-xs text-slate-400">
            {channelLabel(conversation.channelType)}
            {conversation.subject ? ` · ${conversation.subject}` : ''}
          </p>
        </div>
        <AIAssistantMenu
          generating={aiGenerating}
          canDirectReply={writable}
          hasDraft={hasDraft}
          onDraft={onDraft}
          onRegenerate={onRegenerate}
          onReply={onReply}
        />
        <Button size="sm" variant="secondary" onClick={onOpenDetails}>
          Details
        </Button>
      </div>

      {/* Handoff / language row */}
      {(handedOff || conversation.detectedLanguage) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {handedOff && (
            <>
              <Badge color="amber">Handed off to human</Badge>
              {handoffReasonText && (
                <span className="text-xs text-amber-700">{handoffReasonText}</span>
              )}
              {writable && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onSetMode('ENABLED')}
                >
                  Return to AI
                </Button>
              )}
            </>
          )}
          {conversation.detectedLanguage && (
            <span title="Detected customer language">
              <Badge color="slate">
                {conversation.detectedLanguage.toUpperCase()}
              </Badge>
            </span>
          )}
        </div>
      )}

      {/* Controls row */}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <StatusSelector value={conversation.status} disabled={busy} onChange={onStatus} />
        <PrioritySelector value={conversation.priority} disabled={busy} onChange={onPriority} />
        <AssignmentSelector
          value={conversation.assignedUserId}
          users={assignableUsers}
          disabled={busy}
          onChange={onAssign}
        />
        {/* One click = the AI answers this conversation instantly. Reflects both
            gates (company opt-in + this conversation's AI mode) and uses the
            existing endpoints: PUT /ai-settings and PATCH .../ai-mode. */}
        <span
          title={autoReplyHint}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1"
        >
          <span className="text-xs font-medium text-slate-600">
            AI auto-reply
          </span>
          <Toggle
            checked={autoReplyOn}
            disabled={autoReplyDisabled}
            label="AI auto-reply"
            onChange={onToggleAutoReply}
          />
        </span>
        <AIConversationModeSelector
          mode={conversation.aiMode}
          canResume={writable}
          busy={busy}
          onChange={onSetMode}
        />
        {writable && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onArchive}>
            {conversation.isArchived ? 'Unarchive' : 'Archive'}
          </Button>
        )}
        <div className="w-full sm:w-auto">
          <TagSelector
            assigned={assigned}
            all={allTags}
            disabled={busy}
            onAttach={onAttachTag}
            onDetach={onDetachTag}
          />
        </div>
      </div>
    </div>
  );
}
