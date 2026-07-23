'use client';

import { Badge, Button } from '@/components/ui';
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
  onBack,
  onOpenDetails,
  onStatus,
  onPriority,
  onAssign,
  onAttachTag,
  onDetachTag,
  onArchive,
  onSetMode,
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
  onBack: () => void;
  onOpenDetails: () => void;
  onStatus: (s: ConversationStatus) => void;
  onPriority: (p: ConversationPriority) => void;
  onAssign: (userId: string | null) => void;
  onAttachTag: (tagId: string) => void;
  onDetachTag: (tagId: string) => void;
  onArchive: () => void;
  onSetMode: (mode: AIConversationMode) => void;
  onDraft: () => void;
  onRegenerate: (adjustment: RegenerateAdjustment) => void;
  onReply: () => void;
}) {
  const assigned = conversation.tagAssignments.map((a) => a.tag);

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
