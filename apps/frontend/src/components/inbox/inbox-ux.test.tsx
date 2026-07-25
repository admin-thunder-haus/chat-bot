import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationList } from './ConversationList';
import { ConversationFilters } from './ConversationFilters';
import { CompactConversationHeader } from './CompactConversationHeader';
import { MessageThread } from './MessageThread';
import { MessageComposer } from './MessageComposer';
import { DetailsDrawer } from './DetailsDrawer';
import { DEFAULT_FILTERS } from './filter-types';
import type {
  ConversationDetail,
  ConversationListItem,
  Customer,
  Message,
} from '@/lib/types';

const customer: Customer = {
  id: 'c1',
  companyId: 'co1',
  externalId: null,
  channelType: 'WHATSAPP',
  fullName: 'Layla Hassan',
  firstName: null,
  lastName: null,
  phone: '+962790000000',
  email: null,
  username: null,
  avatarUrl: null,
  notes: null,
  metadata: null,
  firstSeenAt: '2026-07-01T10:00:00.000Z',
  lastSeenAt: '2026-07-25T10:00:00.000Z',
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-25T10:00:00.000Z',
};

const row: ConversationListItem = {
  id: 'k1',
  companyId: 'co1',
  customerId: 'c1',
  channelType: 'WHATSAPP',
  status: 'OPEN',
  priority: 'HIGH',
  assignedUserId: null,
  subject: 'Order 4482',
  lastMessageAt: '2026-07-25T10:00:00.000Z',
  lastInboundMessageAt: null,
  lastOutboundMessageAt: null,
  unreadCount: 3,
  isArchived: false,
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-25T10:00:00.000Z',
  customer,
  assignedUser: null,
  tagAssignments: [
    { tag: { id: 't1', companyId: 'co1', name: 'vip', color: null, createdAt: '', updatedAt: '' } },
    { tag: { id: 't2', companyId: 'co1', name: 'refund', color: null, createdAt: '', updatedAt: '' } },
    { tag: { id: 't3', companyId: 'co1', name: 'urgent', color: null, createdAt: '', updatedAt: '' } },
    { tag: { id: 't4', companyId: 'co1', name: 'shipping', color: null, createdAt: '', updatedAt: '' } },
  ],
  messages: [
    {
      id: 'm0',
      content: 'Where is my parcel?',
      direction: 'INBOUND',
      senderType: 'CUSTOMER',
      status: 'RECEIVED',
      createdAt: '2026-07-25T10:00:00.000Z',
    },
  ],
};

const detail: ConversationDetail = {
  ...row,
  resolvedAt: null,
  closedAt: null,
  aiMode: 'ENABLED',
  aiPausedAt: null,
  handoffRequestedAt: null,
  handoffReason: null,
  aiSummary: null,
  aiSummaryGeneratedAt: null,
  detectedLanguage: 'ar',
  customer,
};

function message(over: Partial<Message>): Message {
  return {
    id: 'm1',
    companyId: 'co1',
    conversationId: 'k1',
    customerId: 'c1',
    senderUserId: null,
    direction: 'INBOUND',
    senderType: 'CUSTOMER',
    contentType: 'TEXT',
    content: 'Hello there',
    mediaUrl: null,
    status: 'RECEIVED',
    createdAt: '2026-07-24T09:00:00.000Z',
    sentAt: null,
    senderUser: null,
    ...over,
  };
}

describe('inbox smoke', () => {
  it('list: skeleton, error+retry, filtered empty, and rows with +N tags', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const base = {
      items: [],
      loading: false,
      error: '',
      pagination: null,
      activeId: null,
      filtered: false,
      onSelect: vi.fn(),
      onLoadMore: vi.fn(),
      onRetry,
    };

    const { rerender } = render(<ConversationList {...base} loading />);
    rerender(<ConversationList {...base} error="Network down" />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();

    rerender(<ConversationList {...base} filtered />);
    expect(screen.getByText(/no matching conversations/i)).toBeInTheDocument();

    rerender(<ConversationList {...base} />);
    expect(screen.getByText(/no conversations yet/i)).toBeInTheDocument();

    rerender(<ConversationList {...base} items={[row]} />);
    expect(screen.getByText('Layla Hassan')).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('filters: search always visible, filters toggle exposes state', async () => {
    const user = userEvent.setup();
    render(
      <ConversationFilters
        value={{ ...DEFAULT_FILTERS, status: 'OPEN' }}
        tags={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Search conversations')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /^filters/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('button', { name: /clear filters/i }),
    ).toBeInTheDocument();
  });

  it('header: back arrow, details, and overflow panel with every action', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onArchive = vi.fn();
    render(
      <CompactConversationHeader
        conversation={detail}
        assignableUsers={[]}
        allTags={[]}
        busy={false}
        writable
        aiGenerating={false}
        hasDraft={false}
        companyAutoReplyEnabled
        canManageCompanyAI
        onBack={onBack}
        onOpenDetails={vi.fn()}
        onStatus={vi.fn()}
        onPriority={vi.fn()}
        onAssign={vi.fn()}
        onAttachTag={vi.fn()}
        onDetachTag={vi.fn()}
        onArchive={onArchive}
        onSetMode={vi.fn()}
        onToggleAutoReply={vi.fn()}
        onDraft={vi.fn()}
        onRegenerate={vi.fn()}
        onReply={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Back to conversations' }));
    expect(onBack).toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Open conversation details' }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'More conversation actions' }),
    );
    const panel = screen.getByRole('dialog', { name: 'More conversation actions' });
    expect(panel).toBeInTheDocument();
    // Every gated action is preserved inside the overflow panel.
    for (const label of [
      'Conversation priority',
      'Assign conversation',
      'AI mode',
    ]) {
      expect(within(panel).getByLabelText(label)).toBeInTheDocument();
    }
    await user.click(within(panel).getByRole('button', { name: /archive/i }));
    expect(onArchive).toHaveBeenCalled();
  });

  it('thread: skeletons, empty, error+retry, day separators, no AI badge', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const base = {
      conversationId: 'k1',
      messages: [] as Message[],
      hasMore: false,
      loadingOlder: false,
      loading: false,
      onLoadOlder: vi.fn(),
      onRetry,
      composer: <div data-testid="composer" />,
    };

    const { rerender } = render(<MessageThread {...base} loading />);
    rerender(<MessageThread {...base} />);
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();

    rerender(<MessageThread {...base} error="Could not load" />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();

    rerender(
      <MessageThread
        {...base}
        messages={[
          message({ id: 'a', createdAt: '2026-07-23T09:00:00.000Z' }),
          message({
            id: 'b',
            direction: 'OUTBOUND',
            senderType: 'AI',
            content: 'On its way',
            status: 'SENT',
            createdAt: '2026-07-25T09:00:00.000Z',
          }),
        ]}
      />,
    );
    expect(screen.getByText('Today')).toBeInTheDocument();
    // AI replies stay indistinguishable from an agent reply.
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.queryByText(/^AI$/)).not.toBeInTheDocument();
  });

  it('composer: Enter sends, Shift+Enter newlines, Send stays reachable', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onChange = vi.fn();
    render(
      <MessageComposer
        value="Hi"
        onChange={onChange}
        onSend={onSend}
        toolbar={<div data-testid="toolbar" />}
      />,
    );
    const box = screen.getByLabelText('Message');
    await user.click(box);
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledTimes(1);
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /send/i })).toBeEnabled();
    expect(screen.getByTestId('toolbar')).toBeInTheDocument();
  });

  it('details sheet: own close control and tab semantics', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <DetailsDrawer
        open
        onClose={onClose}
        detail={detail}
        notes={[]}
        activities={[]}
        currentUserId="u1"
        writable
        customerSaving={false}
        onSaveCustomer={vi.fn()}
        onAddNote={vi.fn()}
        onUpdateNote={vi.fn()}
        onDeleteNote={vi.fn()}
        onGenerateSummary={vi.fn()}
      />,
    );
    expect(screen.getByRole('tablist', { name: 'Details sections' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Close details' }));
    expect(onClose).toHaveBeenCalled();
  });
});
