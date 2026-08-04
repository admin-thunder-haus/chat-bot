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
import { AutoReplyToggle } from './AutoReplyToggle';
import { OverflowMenu, OverflowMenuRow } from './OverflowMenu';
import { AIConversationModeSelector } from '@/components/ai/AIConversationModeSelector';
import { AIAssistantMenu } from '@/components/ai/AIAssistantMenu';

function BackIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

const iconButtonClass =
  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';

/**
 * Conversation header.
 *
 * Below `lg` this is the mobile thread header: back arrow, customer name +
 * channel, details, and a `⋯` overflow panel holding the secondary controls.
 * Status and the AI assistant stay on a second visible row so the two things an
 * agent touches most are never buried. At `lg+` every control is laid out inline
 * exactly as before.
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
  onDelete,
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
  /** Opens the delete confirmation. Omitted where deletion is not offered. */
  onDelete?: () => void;
  onSetMode: (mode: AIConversationMode) => void;
  onToggleAutoReply: (next: boolean) => void;
  onDraft: () => void;
  onRegenerate: (adjustment: RegenerateAdjustment) => void;
  onReply: () => void;
}) {
  const assigned = conversation.tagAssignments.map((a) => a.tag);
  const name = customerName(conversation.customer);

  const handedOff =
    Boolean(conversation.handoffRequestedAt) && conversation.aiMode !== 'ENABLED';
  const handoffReasonText =
    conversation.handoffReason === 'customer_request'
      ? 'Customer asked for a human'
      : conversation.handoffReason === 'low_confidence'
        ? "AI couldn't answer"
        : null;

  const aiAssistant = (
    <AIAssistantMenu
      generating={aiGenerating}
      canDirectReply={writable}
      hasDraft={hasDraft}
      onDraft={onDraft}
      onRegenerate={onRegenerate}
      onReply={onReply}
    />
  );

  return (
    <div className="shrink-0 border-b border-slate-200">
      {/* Row 1 — identity + primary actions. Back + name are always visible. */}
      <div className="flex items-center gap-1 px-2 py-1.5 sm:px-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className={`${iconButtonClass} lg:hidden`}
        >
          <BackIcon />
        </button>

        <div className="min-w-0 flex-1 px-1">
          <h2 className="truncate text-sm font-semibold text-slate-900" title={name}>
            {name}
          </h2>
          <p className="truncate text-xs text-slate-400">
            {channelLabel(conversation.channelType)}
            {conversation.subject ? ` · ${conversation.subject}` : ''}
          </p>
        </div>

        {/* Desktop: the assistant and details read as full buttons. */}
        <div className="hidden items-center gap-2 lg:flex">
          {aiAssistant}
          <Button size="sm" variant="secondary" onClick={onOpenDetails}>
            Details
          </Button>
        </div>

        {/* Phone/tablet: icon for details, everything else in the overflow. */}
        <button
          type="button"
          onClick={onOpenDetails}
          aria-label="Open conversation details"
          className={`${iconButtonClass} lg:hidden`}
        >
          <InfoIcon />
        </button>
        <div className="lg:hidden">
          <OverflowMenu label="More conversation actions">
            {(close) => (
              <>
                <OverflowMenuRow label="Priority">
                  <PrioritySelector
                    value={conversation.priority}
                    disabled={busy}
                    className="w-full"
                    onChange={onPriority}
                  />
                </OverflowMenuRow>
                <OverflowMenuRow label="Assignee">
                  <AssignmentSelector
                    value={conversation.assignedUserId}
                    users={assignableUsers}
                    disabled={busy}
                    className="w-full"
                    onChange={onAssign}
                  />
                </OverflowMenuRow>
                <OverflowMenuRow label="AI mode">
                  <AIConversationModeSelector
                    mode={conversation.aiMode}
                    canResume={writable}
                    busy={busy}
                    onChange={onSetMode}
                  />
                </OverflowMenuRow>
                <OverflowMenuRow label="Tags">
                  <TagSelector
                    assigned={assigned}
                    all={allTags}
                    disabled={busy}
                    onAttach={onAttachTag}
                    onDetach={onDetachTag}
                  />
                </OverflowMenuRow>
                {writable && (
                  <Button
                    variant="secondary"
                    fullWidth
                    disabled={busy}
                    onClick={() => {
                      close();
                      onArchive();
                    }}
                  >
                    {conversation.isArchived ? 'Unarchive' : 'Archive'}
                  </Button>
                )}
                {writable && onDelete && (
                  // Only opens the confirm — nothing is destroyed from a menu.
                  <Button
                    variant="danger"
                    fullWidth
                    disabled={busy}
                    onClick={() => {
                      close();
                      onDelete();
                    }}
                  >
                    Delete conversation
                  </Button>
                )}
              </>
            )}
          </OverflowMenu>
        </div>
      </div>

      {/* Row 2 — phone/tablet only: the two most-used controls stay in reach.
          The arbitrary variant lifts the shared assistant trigger to a 40px tap
          target (§5) without editing the shared AI component. */}
      <div className="flex flex-wrap items-center gap-2 px-2 pb-2 sm:px-3 lg:hidden">
        <StatusSelector
          value={conversation.status}
          disabled={busy}
          onChange={onStatus}
        />
        <div className="[&>div>button]:min-h-10">{aiAssistant}</div>
      </div>

      {/* Handoff / detected language — wraps instead of squeezing. */}
      {(handedOff || conversation.detectedLanguage) && (
        <div className="flex flex-wrap items-center gap-2 px-2 pb-2 sm:px-3">
          {handedOff && (
            <>
              <Badge color="amber">Handed off to human</Badge>
              {handoffReasonText && (
                <span className="text-xs text-amber-700">{handoffReasonText}</span>
              )}
              {writable && (
                <Button
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

      {/* Desktop control row — unchanged set, laid out inline. */}
      <div className="hidden flex-wrap items-center gap-x-2 gap-y-1.5 px-3 pb-2 lg:flex">
        <StatusSelector
          value={conversation.status}
          disabled={busy}
          onChange={onStatus}
        />
        <PrioritySelector
          value={conversation.priority}
          disabled={busy}
          onChange={onPriority}
        />
        <AssignmentSelector
          value={conversation.assignedUserId}
          users={assignableUsers}
          disabled={busy}
          onChange={onAssign}
        />
        <AutoReplyToggle
          aiMode={conversation.aiMode}
          companyAutoReplyEnabled={companyAutoReplyEnabled}
          canManageCompanyAI={canManageCompanyAI}
          writable={writable}
          busy={busy}
          onToggle={onToggleAutoReply}
        />
        {/* The shared AI-mode selector stretches to its container, so it gets an
            explicit width here instead of claiming a whole row. */}
        <div className="w-56">
          <AIConversationModeSelector
            mode={conversation.aiMode}
            canResume={writable}
            busy={busy}
            onChange={onSetMode}
          />
        </div>
        {writable && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onArchive}>
            {conversation.isArchived ? 'Unarchive' : 'Archive'}
          </Button>
        )}
        {writable && onDelete && (
          // `ghost` rather than `danger`: this sits in a row of everyday
          // controls, and a permanently red button there invites the misclick
          // it is trying to prevent. The confirm carries the warning.
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={onDelete}
            className="text-red-600 hover:bg-red-50"
          >
            Delete
          </Button>
        )}
        <div className="w-full xl:w-auto">
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
