'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { canWrite } from '@/lib/permissions';
import { useToast } from '@/components/toast';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { parseApiError } from '@/lib/form';
import {
  aiApi,
  conversationsApi,
  customersApi,
  messagesApi,
  notesApi,
  tagsApi,
  usersApi,
  type RegenerateAdjustment,
} from '@/lib/resources';
import type {
  Activity,
  AIConversationMode,
  ConversationDetail,
  ConversationListItem,
  ConversationPriority,
  ConversationStatus,
  Message,
  Note,
  Pagination,
  Tag,
  UserSummary,
} from '@/lib/types';
import { Button, Spinner } from '@/components/ui';
import { ConversationFilters } from '@/components/inbox/ConversationFilters';
import { ConversationList } from '@/components/inbox/ConversationList';
import { CompactConversationHeader } from '@/components/inbox/CompactConversationHeader';
import { MessageThread } from '@/components/inbox/MessageThread';
import { MessageComposer } from '@/components/inbox/MessageComposer';
import { DetailsDrawer } from '@/components/inbox/DetailsDrawer';
import { SuggestionPanel } from '@/components/inbox/SuggestionPanel';
import { NewConversationModal } from '@/components/inbox/NewConversationModal';
import { AIHandoffBanner } from '@/components/ai/AIHandoffBanner';
import { DEFAULT_FILTERS, type FilterState } from '@/components/inbox/filter-types';

const LIST_LIMIT = 20;
const MSG_LIMIT = 30;

function InboxInner() {
  const { user } = useAuth();
  const { notify } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const writable = canWrite(user?.role);

  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [assignableUsers, setAssignableUsers] = useState<UserSummary[]>([]);

  // Conversation list.
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const debouncedSearch = useDebouncedValue(filters.search, 300);
  const [items, setItems] = useState<ConversationListItem[]>([]);
  const [listPage, setListPage] = useState(1);
  const [listPagination, setListPagination] = useState<Pagination | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const listReq = useRef(0);

  // Active conversation.
  const [activeId, setActiveId] = useState<string | null>(
    searchParams.get('conversationId'),
  );
  const activeIdRef = useRef<string | null>(activeId);
  activeIdRef.current = activeId;

  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Messages (cursor pagination).
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgCursor, setMsgCursor] = useState<string | null>(null);
  const [msgHasMore, setMsgHasMore] = useState(false);
  const [msgLoading, setMsgLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const [notes, setNotes] = useState<Note[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  // Right details panel is a drawer, hidden by default.
  const [detailsOpen, setDetailsOpen] = useState(false);

  const [composerText, setComposerText] = useState('');
  const [sending, setSending] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestSending, setSuggestSending] = useState(false);
  const [headerBusy, setHeaderBusy] = useState(false);
  const [customerSaving, setCustomerSaving] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => {
    tagsApi.list().then((r) => setAllTags(r.tags)).catch(() => undefined);
    usersApi.assignable().then((r) => setAssignableUsers(r.users)).catch(() => undefined);
  }, []);

  const buildParams = useCallback(
    (page: number) => ({
      page,
      limit: LIST_LIMIT,
      sortBy: 'lastMessageAt',
      sortOrder: 'desc' as const,
      search: debouncedSearch || undefined,
      status: filters.status || undefined,
      priority: filters.priority || undefined,
      channelType: filters.channelType || undefined,
      tagId: filters.tagId || undefined,
      unreadOnly: filters.unreadOnly || undefined,
      archived: filters.archived || undefined,
      assignedUserId: filters.assignment === 'mine' ? user?.id : undefined,
      unassigned: filters.assignment === 'unassigned' || undefined,
    }),
    [debouncedSearch, filters, user?.id],
  );

  const loadList = useCallback(
    async (page: number, append: boolean, silent = false) => {
      const reqId = ++listReq.current;
      if (!silent) setListLoading(true);
      setListError('');
      try {
        const res = await conversationsApi.list(buildParams(page));
        if (reqId !== listReq.current) return;
        setListPagination(res.pagination);
        setListPage(page);
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
      } catch (err) {
        if (reqId === listReq.current && !silent)
          setListError(parseApiError(err).message);
      } finally {
        if (reqId === listReq.current && !silent) setListLoading(false);
      }
    },
    [buildParams],
  );

  useEffect(() => {
    void loadList(1, false);
  }, [loadList]);

  const patchListItem = useCallback(
    (id: string, patch: Partial<ConversationListItem>) => {
      setItems((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    },
    [],
  );

  const loadBundle = useCallback(
    async (id: string) => {
      // Immediately clear stale thread state so nothing leaks across switches.
      setDetail(null);
      setMessages([]);
      setNotes([]);
      setActivities([]);
      setComposerText('');
      setHasDraft(false);
      setSuggestions(null);
      setSuggestLoading(false);
      setMsgCursor(null);
      setMsgHasMore(false);
      setDetailLoading(true);
      setMsgLoading(true);
      try {
        const [d, m, n, a] = await Promise.all([
          conversationsApi.get(id),
          messagesApi.list(id, { limit: MSG_LIMIT }),
          notesApi.list(id),
          conversationsApi.activity(id),
        ]);
        if (activeIdRef.current !== id) return; // stale — user switched away
        setDetail(d.conversation);
        setMessages(m.items);
        setMsgCursor(m.nextCursor);
        setMsgHasMore(m.hasMore);
        setNotes(n.notes);
        setActivities(a.activities);
        if (d.conversation.unreadCount > 0) {
          await conversationsApi.markRead(id);
          if (activeIdRef.current === id) {
            setDetail((prev) => (prev ? { ...prev, unreadCount: 0 } : prev));
            patchListItem(id, { unreadCount: 0 });
          }
        }
      } catch (err) {
        if (activeIdRef.current === id) notify(parseApiError(err).message, 'error');
      } finally {
        if (activeIdRef.current === id) {
          setDetailLoading(false);
          setMsgLoading(false);
        }
      }
    },
    [notify, patchListItem],
  );

  useEffect(() => {
    if (activeId) void loadBundle(activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // --- Live polling: keep the open thread + list fresh without a manual refresh.
  // Merges only NEW messages into the open thread (no flicker, no scroll reset)
  // and silently refreshes the list on page 1.
  const refreshActive = useCallback(async (id: string) => {
    try {
      const [m, a] = await Promise.all([
        messagesApi.list(id, { limit: MSG_LIMIT }),
        conversationsApi.activity(id),
      ]);
      if (activeIdRef.current !== id) return;
      setMessages((prev) => {
        const byId = new Map(prev.map((x) => [x.id, x]));
        let added = false;
        for (const msg of m.items)
          if (!byId.has(msg.id)) {
            byId.set(msg.id, msg);
            added = true;
          }
        if (!added) return prev;
        return [...byId.values()].sort(
          (x, y) =>
            new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime(),
        );
      });
      setActivities(a.activities);
    } catch {
      /* transient poll error — ignore */
    }
  }, []);

  const listPageRef = useRef(1);
  useEffect(() => {
    listPageRef.current = listPage;
  }, [listPage]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (listPageRef.current === 1) void loadList(1, false, true);
      const id = activeIdRef.current;
      if (id) void refreshActive(id);
    }, 6000);
    return () => clearInterval(interval);
  }, [loadList, refreshActive]);

  function selectConversation(id: string) {
    setActiveId(id);
    router.replace(`/dashboard/inbox?conversationId=${id}`, { scroll: false });
  }

  async function loadOlder() {
    if (!activeId || !msgCursor || loadingOlder) return;
    const id = activeId;
    setLoadingOlder(true);
    try {
      const res = await messagesApi.list(id, { limit: MSG_LIMIT, before: msgCursor });
      if (activeIdRef.current !== id) return;
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const older = res.items.filter((m) => !seen.has(m.id));
        return [...older, ...prev];
      });
      setMsgCursor(res.nextCursor);
      setMsgHasMore(res.hasMore);
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      if (activeIdRef.current === id) setLoadingOlder(false);
    }
  }

  async function refreshActivities(id: string) {
    try {
      const a = await conversationsApi.activity(id);
      if (activeIdRef.current === id) setActivities(a.activities);
    } catch {
      /* non-critical */
    }
  }

  function appendMessage(id: string, message: Message) {
    if (activeIdRef.current === id) {
      setMessages((prev) =>
        prev.some((m) => m.id === message.id) ? prev : [...prev, message],
      );
    }
    patchListItem(id, {
      messages: [
        {
          id: message.id,
          content: message.content,
          direction: message.direction,
          senderType: message.senderType,
          status: message.status,
          createdAt: message.createdAt,
        },
      ],
      lastMessageAt: message.createdAt,
    });
  }

  async function onSend() {
    if (!detail || sending || !composerText.trim()) return;
    const id = detail.id;
    setSending(true);
    try {
      const { message } = await messagesApi.send(id, composerText.trim());
      appendMessage(id, message);
      setComposerText('');
      setHasDraft(false);
      await refreshActivities(id);
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setSending(false);
    }
  }

  // --- AI actions ---
  async function generateDraft() {
    if (!detail) return;
    const id = detail.id;
    setAiGenerating(true);
    try {
      const result = await aiApi.draft(id);
      if (activeIdRef.current !== id) return; // stale — user switched
      setComposerText(result.text);
      setHasDraft(true);
      notify(
        `AI draft ready${result.usedFallback ? ' (general fallback)' : ''} · ~${result.totalTokens ?? 0} tokens`,
        'success',
      );
      if (result.handoffRequested) {
        notify('The customer may want a human — review carefully.', 'info');
      }
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      if (activeIdRef.current === id) setAiGenerating(false);
    }
  }

  async function regenerate(adjustment: RegenerateAdjustment) {
    if (!detail) return;
    const id = detail.id;
    setAiGenerating(true);
    try {
      const result = await aiApi.regenerate(id, adjustment);
      if (activeIdRef.current !== id) return;
      setComposerText(result.text);
      setHasDraft(true);
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      if (activeIdRef.current === id) setAiGenerating(false);
    }
  }

  async function generateSuggestions() {
    if (!detail || suggestLoading) return;
    const id = detail.id;
    setSuggestLoading(true);
    try {
      const res = await aiApi.suggestions(id, 2);
      if (activeIdRef.current !== id) return; // stale — user switched
      setSuggestions(res.suggestions);
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      if (activeIdRef.current === id) setSuggestLoading(false);
    }
  }

  function applySuggestion(text: string) {
    setComposerText(text);
    setHasDraft(true);
    setSuggestions(null);
  }

  async function sendSuggestion(text: string) {
    if (!detail || suggestSending) return;
    const id = detail.id;
    setSuggestSending(true);
    try {
      const { message } = await messagesApi.send(id, text.trim());
      appendMessage(id, message);
      setSuggestions(null);
      await refreshActivities(id);
      notify('Suggestion sent', 'success');
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      if (activeIdRef.current === id) setSuggestSending(false);
    }
  }

  async function generateSummary() {
    if (!detail) return;
    const id = detail.id;
    try {
      const res = await aiApi.summarize(id);
      if (activeIdRef.current === id) {
        setDetail((prev) =>
          prev && prev.id === id
            ? {
                ...prev,
                aiSummary: res.summary,
                aiSummaryGeneratedAt: res.generatedAt,
              }
            : prev,
        );
        notify('Summary generated', 'success');
      }
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    }
  }

  async function directReply() {
    if (!detail) return;
    const id = detail.id;
    setAiGenerating(true);
    try {
      const { message } = await aiApi.reply(id);
      appendMessage(id, message);
      await refreshActivities(id);
      notify('AI reply sent', 'success');
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      if (activeIdRef.current === id) setAiGenerating(false);
    }
  }

  // --- header / mode / customer / notes ---
  function applyDetail(updated: ConversationDetail) {
    setDetail(updated);
    patchListItem(updated.id, {
      status: updated.status,
      priority: updated.priority,
      assignedUserId: updated.assignedUserId,
      assignedUser: updated.assignedUser,
      isArchived: updated.isArchived,
      tagAssignments: updated.tagAssignments,
    });
  }

  async function withHeader(fn: () => Promise<void>) {
    if (!detail) return;
    setHeaderBusy(true);
    try {
      await fn();
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setHeaderBusy(false);
    }
  }

  const onStatus = (status: ConversationStatus) =>
    withHeader(async () => {
      const { conversation } = await conversationsApi.setStatus(detail!.id, status);
      applyDetail(conversation);
      await refreshActivities(detail!.id);
    });
  const onPriority = (priority: ConversationPriority) =>
    withHeader(async () => {
      const { conversation } = await conversationsApi.setPriority(detail!.id, priority);
      applyDetail(conversation);
      await refreshActivities(detail!.id);
    });
  const onAssign = (userId: string | null) =>
    withHeader(async () => {
      const { conversation } = await conversationsApi.setAssignment(detail!.id, userId);
      applyDetail(conversation);
      await refreshActivities(detail!.id);
    });
  const onArchive = () =>
    withHeader(async () => {
      const { conversation } = await conversationsApi.setArchived(detail!.id, !detail!.isArchived);
      applyDetail(conversation);
    });
  const onAttachTag = (tagId: string) =>
    withHeader(async () => {
      const { tags } = await conversationsApi.attachTag(detail!.id, tagId);
      applyDetail({ ...detail!, tagAssignments: tags.map((t) => ({ tag: t })) });
      await refreshActivities(detail!.id);
    });
  const onDetachTag = (tagId: string) =>
    withHeader(async () => {
      const { tags } = await conversationsApi.detachTag(detail!.id, tagId);
      applyDetail({ ...detail!, tagAssignments: tags.map((t) => ({ tag: t })) });
      await refreshActivities(detail!.id);
    });
  const onSetMode = (mode: AIConversationMode) =>
    withHeader(async () => {
      const { conversation } = await aiApi.setMode(detail!.id, mode);
      applyDetail(conversation);
      await refreshActivities(detail!.id);
      notify('AI mode updated', 'success');
    });

  async function addNote(content: string) {
    if (!detail) return;
    const { note } = await notesApi.create(detail.id, content);
    setNotes((prev) => [...prev, note]);
    await refreshActivities(detail.id);
    notify('Note added', 'success');
  }
  async function updateNote(noteId: string, content: string) {
    if (!detail) return;
    const { note } = await notesApi.update(detail.id, noteId, content);
    setNotes((prev) => prev.map((n) => (n.id === noteId ? note : n)));
  }
  async function deleteNote(noteId: string) {
    if (!detail) return;
    await notesApi.remove(detail.id, noteId);
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  }
  async function saveCustomer(patch: Record<string, string | null>) {
    if (!detail) return;
    setCustomerSaving(true);
    try {
      const { customer } = await customersApi.update(detail.customer.id, patch);
      setDetail((prev) => (prev ? { ...prev, customer } : prev));
      notify('Customer updated', 'success');
    } catch (err) {
      notify(parseApiError(err).message, 'error');
    } finally {
      setCustomerSaving(false);
    }
  }

  const assignOptions =
    user?.role === 'AGENT'
      ? assignableUsers.filter((u) => u.id === user.id)
      : assignableUsers;

  return (
    <>
      <div className="h-[calc(100vh-8rem)] overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex h-full">
          {/* LEFT: conversation list (own scroll) */}
          <aside
            className={`${activeId ? 'hidden md:flex' : 'flex'} h-full w-full min-h-0 flex-col md:w-80 md:shrink-0 md:border-r md:border-slate-200`}
          >
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-sm font-semibold text-slate-900">Inbox</span>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => void loadList(1, false)}>
                  Refresh
                </Button>
                {writable && (
                  <Button size="sm" onClick={() => setNewOpen(true)}>
                    New
                  </Button>
                )}
              </div>
            </div>
            <ConversationFilters
              value={filters}
              tags={allTags}
              onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
            />
            <div className="min-h-0 flex-1">
              <ConversationList
                items={items}
                loading={listLoading}
                error={listError}
                pagination={listPagination}
                activeId={activeId}
                onSelect={selectConversation}
                onLoadMore={() => void loadList(listPage + 1, true)}
              />
            </div>
          </aside>

          {/* CENTER: message area (own scroll, composer fixed at bottom) */}
          <section
            className={`${activeId ? 'flex' : 'hidden md:flex'} h-full min-h-0 min-w-0 flex-1 flex-col`}
          >
            {!activeId ? (
              <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-400">
                Select a conversation to get started.
              </div>
            ) : detailLoading && !detail ? (
              <div className="flex flex-1 items-center justify-center">
                <Spinner size={24} />
              </div>
            ) : detail ? (
              <>
                <CompactConversationHeader
                  conversation={detail}
                  assignableUsers={assignOptions}
                  allTags={allTags}
                  busy={headerBusy}
                  writable={writable}
                  aiGenerating={aiGenerating}
                  hasDraft={hasDraft}
                  onBack={() => {
                    setActiveId(null);
                    router.replace('/dashboard/inbox', { scroll: false });
                  }}
                  onOpenDetails={() => setDetailsOpen(true)}
                  onStatus={onStatus}
                  onPriority={onPriority}
                  onAssign={onAssign}
                  onAttachTag={onAttachTag}
                  onDetachTag={onDetachTag}
                  onArchive={onArchive}
                  onSetMode={onSetMode}
                  onDraft={() => void generateDraft()}
                  onRegenerate={(a) => void regenerate(a)}
                  onReply={() => void directReply()}
                />

                <AIHandoffBanner
                  conversation={detail}
                  canResume={writable}
                  busy={headerBusy}
                  onResume={() => onSetMode('ENABLED')}
                />

                <MessageThread
                  conversationId={detail.id}
                  messages={messages}
                  hasMore={msgHasMore}
                  loadingOlder={loadingOlder}
                  loading={msgLoading}
                  onLoadOlder={() => void loadOlder()}
                  composer={
                    <MessageComposer
                      value={composerText}
                      onChange={setComposerText}
                      onSend={() => void onSend()}
                      sending={sending}
                      toolbar={
                        <div className="space-y-2">
                          {(suggestLoading || suggestions) && (
                            <SuggestionPanel
                              suggestions={suggestions}
                              loading={suggestLoading}
                              composerHasText={composerText.trim().length > 0}
                              busy={suggestSending}
                              onUse={applySuggestion}
                              onSend={(text) => void sendSuggestion(text)}
                              onDismiss={() => setSuggestions(null)}
                            />
                          )}
                          <div className="flex justify-end">
                            <button
                              type="button"
                              disabled={suggestLoading}
                              onClick={() => void generateSuggestions()}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-60"
                            >
                              {suggestLoading ? <Spinner size={11} /> : '✨'}{' '}
                              Suggest
                            </button>
                          </div>
                        </div>
                      }
                    />
                  }
                />
              </>
            ) : null}
          </section>
        </div>
      </div>

      {/* Details drawer — hidden by default, opened via the "Details" button */}
      {activeId && detail && (
        <DetailsDrawer
          open={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          detail={detail}
          notes={notes}
          activities={activities}
          currentUserId={user!.id}
          writable={writable}
          customerSaving={customerSaving}
          onSaveCustomer={saveCustomer}
          onAddNote={addNote}
          onUpdateNote={updateNote}
          onDeleteNote={deleteNote}
          onGenerateSummary={generateSummary}
        />
      )}

      <NewConversationModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(id) => {
          setNewOpen(false);
          void loadList(1, false);
          selectConversation(id);
          notify('Conversation created', 'success');
        }}
      />
    </>
  );
}

export default function InboxPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <Spinner size={24} />
        </div>
      }
    >
      <InboxInner />
    </Suspense>
  );
}
