import type {
  Customer,
  Message,
  Prisma,
  ReplyTone,
  UserRole,
  AIConversationMode,
  AIGenerationType,
} from '@prisma/client';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { AppError } from '../../utils/AppError';
import { logActivity } from '../../utils/activity';
import { conversationsRepository } from '../conversations/conversations.repository';
import type { ConversationDetail } from '../conversations/conversations.repository';
import { messagesRepository } from '../messages/messages.repository';
import { channelDeliveryService } from '../channels/channel-delivery.service';
import { channelRegistry } from '../channels/channel-registry';
import { channelsRepository } from '../channels/channels.repository';
import { aiSettingsService } from '../ai-settings/ai-settings.service';
import type { AISettingsView } from '../ai-settings/ai-settings.types';
import { getAIProvider } from './ai.provider.factory';
import { aiRetrievalService } from './ai-retrieval.service';
import { aiContextService } from './ai-context.service';
import {
  aiPromptService,
  detectInjection,
  HANDOFF_SENTINEL,
  PROMPT_VERSION,
} from './ai-prompt.service';
import { detectLanguage } from '../../utils/language-detect';
import { aiRepository } from './ai.repository';
import { aiUsageService } from './ai-usage.service';
import { AIError } from './ai.errors';
import { estimateCostUsd } from './ai.pricing';
import type {
  AIGenerationResult,
  ContextSummary,
  HistoryTurn,
} from './ai.types';

const HANDOFF_PATTERNS: RegExp[] = [
  /speak\s+(to|with)\s+(a\s+)?(human|person|agent|representative|someone)/i,
  /talk\s+(to|with)\s+(a\s+)?(human|person|agent|representative|someone)/i,
  /real\s+(human|person)/i,
  /human\s+(agent|support|help|being)/i,
  /(customer\s+service|support)\s+(agent|representative|person)/i,
  // Arabic: "I want to talk to an employee/human/someone", "transfer me to …",
  // "a real human". Kept conservative so ordinary questions never trigger.
  /(بدي|أريد|اريد|ممكن)\s+(احكي|أحكي|اتكلم|أتكلم|التحدث|الحديث|اتواصل|أتواصل)\s+مع\s+(موظف|انسان|إنسان|شخص|حدا|أحد|بشر)/,
  /(حولني|حوليني|وصلني|وصليني)\s+(على|الى|إلى|ل)\s*(موظف|انسان|إنسان|خدمة\s+العملاء|الدعم)/,
  /(موظف|انسان|إنسان)\s+(حقيقي|بشري)/,
  // Spanish / French / German equivalents.
  /hablar\s+con\s+(un\s+|una\s+)?(humano|agente|persona)/i,
  /parler\s+(à|a|avec)\s+(un\s+)?(humain|agent|conseiller)/i,
  /mit\s+einem\s+(menschen|mitarbeiter|berater)\s+sprechen/i,
];

/**
 * True when the customer is explicitly asking for a human. Built-in patterns
 * cover common languages; companies can add their own trigger phrases via
 * AI settings (`handoffKeywords`, matched case-insensitively as substrings).
 */
export function detectHandoffRequest(
  text: string,
  extraKeywords: string[] = [],
): boolean {
  if (HANDOFF_PATTERNS.some((re) => re.test(text))) return true;
  if (extraKeywords.length === 0) return false;
  const lowered = text.toLowerCase();
  return extraKeywords.some(
    (k) => k.trim().length >= 2 && lowered.includes(k.trim().toLowerCase()),
  );
}

/** Regenerate adjustments come from a fixed enum — safe, never free-form. */
export const REGENERATE_ADJUSTMENTS: Record<string, string> = {
  shorter: 'Make the reply noticeably shorter.',
  friendlier: 'Make the reply warmer and friendlier.',
  more_formal: 'Make the reply more formal.',
  arabic: 'Write the reply in Arabic.',
  english: 'Write the reply in English.',
};

function toHistoryTurn(row: {
  direction: string;
  senderType: string;
  content: string;
}): HistoryTurn {
  const role: 'user' | 'assistant' =
    row.direction === 'OUTBOUND' ? 'assistant' : 'user';
  const senderLabel: HistoryTurn['senderLabel'] =
    row.senderType === 'CUSTOMER'
      ? 'Customer'
      : row.senderType === 'AI'
        ? 'AI'
        : 'Agent';
  return { role, senderLabel, content: row.content };
}

/** Safe serialization of a generation — omits provider internals & raw failure. */
export function serializeGeneration(g: {
  id: string;
  conversationId: string | null;
  generationType: AIGenerationType;
  status: string;
  provider: string;
  model: string;
  inputTokenCount: number | null;
  outputTokenCount: number | null;
  totalTokenCount: number | null;
  estimatedCostUsd: Prisma.Decimal | null;
  latencyMs: number | null;
  responseText: string | null;
  failureCode: string | null;
  contextSummary: Prisma.JsonValue;
  createdAt: Date;
  completedAt: Date | null;
  failedAt: Date | null;
}) {
  return {
    id: g.id,
    conversationId: g.conversationId,
    generationType: g.generationType,
    status: g.status,
    provider: g.provider,
    model: g.model,
    inputTokenCount: g.inputTokenCount,
    outputTokenCount: g.outputTokenCount,
    totalTokenCount: g.totalTokenCount,
    estimatedCostUsd: g.estimatedCostUsd === null ? null : g.estimatedCostUsd.toString(),
    latencyMs: g.latencyMs,
    responseText: g.responseText,
    failureCode: g.failureCode,
    contextSummary: g.contextSummary,
    createdAt: g.createdAt,
    completedAt: g.completedAt,
    failedAt: g.failedAt,
  };
}

interface RunInput {
  companyId: string;
  conversationId?: string;
  generationType: AIGenerationType;
  requestedByUserId?: string | null;
  question: string;
  customer?: Customer | null;
  includeHistory: boolean;
  sourceMessageId?: string | null;
  adjustment?: string;
  settingsOverride?: AISettingsView;
  /** Allow the model to signal low-confidence handoff via the sentinel. */
  allowHandoffSignal?: boolean;
}

/** Core generation pipeline shared by all modes. */
async function runGeneration(input: RunInput): Promise<AIGenerationResult> {
  const settings = input.settingsOverride ?? (await aiSettingsService.get(input.companyId));

  // Quota check BEFORE any provider call so quota errors never spend tokens.
  await aiUsageService.assertWithinQuota(input.companyId);

  const injectionSuspected = detectInjection(input.question);
  const retrieval = await aiRetrievalService.retrieve(input.companyId, input.question);
  const ctx = await aiContextService.build(
    input.companyId,
    retrieval,
    input.customer ?? null,
  );

  let history: HistoryTurn[] = [];
  if (input.includeHistory && input.conversationId) {
    const rows = await aiRepository.recentHistory(
      input.companyId,
      input.conversationId,
      env.AI_CONVERSATION_HISTORY_LIMIT,
    );
    history = rows
      .filter((r) => r.id !== input.sourceMessageId) // avoid duplicating current msg
      .map(toHistoryTurn);
  }

  const provider = getAIProvider(); // throws AI_DISABLED / AI_NOT_CONFIGURED

  const contextSummary: ContextSummary = {
    ...ctx.summary,
    historyMessageCount: history.length,
    injectionSuspected,
  };

  const generation = await aiRepository.createGeneration({
    companyId: input.companyId,
    conversationId: input.conversationId ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
    requestedByUserId: input.requestedByUserId ?? null,
    generationType: input.generationType,
    status: 'PENDING',
    provider: provider.name,
    model: env.OPENAI_MODEL,
    promptVersion: PROMPT_VERSION,
    contextSummary: contextSummary as unknown as Prisma.InputJsonValue,
  });

  // Automatic language mirroring: detect the language of the customer's
  // latest message so 'auto' replies always match it (mixed conversations
  // follow the most recent message). Channel-agnostic by design.
  const detectedLanguage = detectLanguage(input.question);

  const systemPrompt = aiPromptService.buildSystemPrompt({
    companyName: ctx.companyName,
    contextText: ctx.contextText,
    settings,
    injectionSuspected,
    adjustment: input.adjustment,
    detectedLanguage,
    allowHandoffSignal: input.allowHandoffSignal ?? false,
  });
  const messages = aiPromptService.buildMessages(history, input.question);

  try {
    const providerResult = await provider.generateResponse({
      systemPrompt,
      messages,
      model: env.OPENAI_MODEL,
      maxOutputTokens: env.OPENAI_MAX_OUTPUT_TOKENS,
      temperature: env.OPENAI_TEMPERATURE,
      timeoutMs: env.OPENAI_TIMEOUT_MS,
      maxRetries: env.OPENAI_MAX_RETRIES,
    });

    const cost = estimateCostUsd(
      providerResult.model,
      providerResult.inputTokens,
      providerResult.outputTokens,
    );

    await aiUsageService.record(input.companyId, {
      inputTokens: providerResult.inputTokens ?? 0,
      outputTokens: providerResult.outputTokens ?? 0,
      totalTokens: providerResult.totalTokens ?? 0,
      estimatedCostUsd: cost ?? 0,
    });

    await aiRepository.updateGeneration(input.companyId, generation.id, {
      status: 'COMPLETED',
      inputTokenCount: providerResult.inputTokens,
      outputTokenCount: providerResult.outputTokens,
      totalTokenCount: providerResult.totalTokens,
      estimatedCostUsd: cost,
      latencyMs: providerResult.latencyMs,
      responseText: providerResult.text,
      providerResponseId: providerResult.providerResponseId,
      completedAt: new Date(),
    });

    logger.info('ai.generation.completed', {
      companyId: input.companyId,
      conversationId: input.conversationId,
      generationId: generation.id,
      provider: providerResult.provider,
      model: providerResult.model,
      latencyMs: providerResult.latencyMs,
      totalTokens: providerResult.totalTokens,
    });

    // Low-confidence signal: the model emits the sentinel when it cannot help
    // from company information. Customers never see the sentinel — the reply
    // becomes the configured handoff message and callers pause the AI.
    const lowConfidence =
      (input.allowHandoffSignal ?? false) &&
      providerResult.text.includes(HANDOFF_SENTINEL);
    const text = lowConfidence
      ? settings.humanHandoffMessage
      : providerResult.text;

    return {
      generationId: generation.id,
      generationType: input.generationType,
      text,
      model: providerResult.model,
      provider: providerResult.provider,
      inputTokens: providerResult.inputTokens,
      outputTokens: providerResult.outputTokens,
      totalTokens: providerResult.totalTokens,
      estimatedCostUsd: cost,
      latencyMs: providerResult.latencyMs,
      handoffRequested:
        injectionSuspected ||
        lowConfidence ||
        detectHandoffRequest(input.question, settings.handoffKeywords),
      lowConfidence,
      detectedLanguage,
      usedFallback: retrieval.usedFallback,
      contextSummary,
      // Deterministic post-step: if the reply names a retrieved service or
      // product that has an image, that image rides along with the reply.
      attachment: lowConfidence
        ? null
        : aiContextService.findRecommendedAttachment(
            providerResult.text,
            retrieval,
          ),
    };
  } catch (err) {
    const code = err instanceof AIError ? err.code : 'AI_UNAVAILABLE';
    await aiRepository.updateGeneration(input.companyId, generation.id, {
      status: 'FAILED',
      failureCode: code,
      failureMessage:
        err instanceof AIError ? err.message : 'AI generation failed',
      failedAt: new Date(),
    });
    logger.error('ai.generation.failed', {
      companyId: input.companyId,
      generationId: generation.id,
      failureCode: code,
    });
    throw err;
  }
}

/** Latest inbound customer message for a conversation (the default question). */
async function latestInbound(
  companyId: string,
  conversationId: string,
): Promise<{ id: string; content: string } | null> {
  const msg = await prisma.message.findFirst({
    where: { companyId, conversationId, direction: 'INBOUND' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, content: true },
  });
  return msg;
}

async function persistAiReply(
  companyId: string,
  conversationId: string,
  customerId: string,
  // Null for system-originated messages (e.g. the handoff notice), which have
  // no generation to link.
  generationId: string | null,
  text: string,
  senderUserId: string | null,
  attachmentUrl: string | null = null,
  senderType: 'AI' | 'SYSTEM' = 'AI',
): Promise<Message> {
  // When the conversation belongs to a push channel (WhatsApp / Instagram /
  // Facebook), the AI reply MUST go through the delivery engine so it is
  // actually sent to the provider — persisting the message alone never reaches
  // the customer. Web Chat / manual conversations keep the local persist path
  // (the widget pulls; manual has no provider).
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, companyId },
  });
  const account =
    conv?.channelAccountId && conv.providerKey
      ? await channelsRepository.findByIdScoped(companyId, conv.channelAccountId)
      : null;
  const provider = conv?.providerKey
    ? channelRegistry.tryGet(conv.providerKey)
    : null;
  const viaProvider =
    !!conv &&
    !!account &&
    account.isEnabled &&
    !!provider &&
    provider.capabilities.outboundMessaging &&
    provider.capabilities.textMessages;

  if (viaProvider && conv && account) {
    // Attach the image only when the provider can actually deliver media;
    // otherwise the reply gracefully falls back to text-only.
    const mediaUrl =
      attachmentUrl && provider!.capabilities.mediaMessages
        ? attachmentUrl
        : null;
    const message = await channelDeliveryService.dispatchOutbound({
      companyId,
      conversation: conv,
      account,
      senderUserId,
      senderType,
      content: text,
      mediaUrl,
      actorUserId: senderUserId,
    });
    if (generationId) {
      await prisma.aIResponseGeneration.updateMany({
        where: { id: generationId, companyId },
        data: { generatedMessageId: message.id },
      });
    }
    return message;
  }

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    // Local path (Web Chat / manual): the image is always persisted — the
    // widget and dashboard inbox both render it directly.
    const message = await messagesRepository.create(tx, companyId, {
      conversationId,
      customerId,
      senderUserId,
      direction: 'OUTBOUND',
      senderType,
      contentType: attachmentUrl ? 'IMAGE' : 'TEXT',
      content: text,
      mediaUrl: attachmentUrl,
      status: 'SENT',
      sentAt: now,
    });
    await conversationsRepository.updateById(tx, conversationId, {
      lastMessageAt: now,
      lastOutboundMessageAt: now,
    });
    await logActivity(tx, {
      companyId,
      conversationId,
      actorUserId: senderUserId,
      activityType: 'MESSAGE_SENT',
      metadata: { ai: senderType === 'AI', generationId, messageId: message.id },
    });
    if (generationId) {
      await tx.aIResponseGeneration.updateMany({
        where: { id: generationId, companyId },
        data: { generatedMessageId: message.id },
      });
    }
    return message;
  });
}

export const aiService = {
  async generateDraft(
    companyId: string,
    conversationId: string,
    userId: string,
    instruction?: string,
  ): Promise<AIGenerationResult> {
    await conversationsRepository.findByIdScoped(companyId, conversationId).then(
      (c) => {
        if (!c) throw AppError.notFound('Conversation not found');
      },
    );
    const inbound = await latestInbound(companyId, conversationId);
    if (!inbound) {
      throw AppError.badRequest('No customer message to respond to yet');
    }
    return runGeneration({
      companyId,
      conversationId,
      generationType: 'DRAFT',
      requestedByUserId: userId,
      question: inbound.content,
      sourceMessageId: inbound.id,
      includeHistory: true,
      adjustment: instruction,
    });
  },

  async regenerate(
    companyId: string,
    conversationId: string,
    userId: string,
    adjustmentKey: string,
  ): Promise<AIGenerationResult> {
    const conv = await conversationsRepository.findByIdScoped(companyId, conversationId);
    if (!conv) throw AppError.notFound('Conversation not found');
    const inbound = await latestInbound(companyId, conversationId);
    if (!inbound) {
      throw AppError.badRequest('No customer message to respond to yet');
    }
    return runGeneration({
      companyId,
      conversationId,
      generationType: 'REGENERATE',
      requestedByUserId: userId,
      question: inbound.content,
      sourceMessageId: inbound.id,
      includeHistory: true,
      adjustment: REGENERATE_ADJUSTMENTS[adjustmentKey],
    });
  },

  async replyAndSend(
    companyId: string,
    conversationId: string,
    userId: string,
  ): Promise<{ result: AIGenerationResult; message: Message }> {
    const conv = await conversationsRepository.findByIdScoped(companyId, conversationId);
    if (!conv) throw AppError.notFound('Conversation not found');
    const inbound = await latestInbound(companyId, conversationId);
    if (!inbound) {
      throw AppError.badRequest('No customer message to respond to yet');
    }
    const result = await runGeneration({
      companyId,
      conversationId,
      generationType: 'AUTO_REPLY',
      requestedByUserId: userId,
      question: inbound.content,
      sourceMessageId: inbound.id,
      includeHistory: true,
    });
    const message = await persistAiReply(
      companyId,
      conversationId,
      conv.customerId,
      result.generationId,
      result.text,
      userId,
      result.attachment?.imageUrl ?? null,
    );
    return { result, message };
  },

  async playground(
    companyId: string,
    userId: string,
    input: {
      question: string;
      tone?: ReplyTone;
      language?: string;
      includeHistory?: boolean;
    },
  ): Promise<AIGenerationResult> {
    const settings = await aiSettingsService.get(companyId);
    const override: AISettingsView = {
      ...settings,
      replyTone: input.tone ?? settings.replyTone,
      preferredLanguage: input.language ?? settings.preferredLanguage,
    };
    return runGeneration({
      companyId,
      generationType: 'PLAYGROUND',
      requestedByUserId: userId,
      question: input.question,
      includeHistory: false,
      settingsOverride: override,
    });
  },

  /**
   * Auto-reply for a freshly stored inbound (mock) message. Returns a result
   * describing whether a reply was generated; NEVER throws for provider/quota
   * failures so the inbound message is preserved by the caller.
   */
  async autoReplyForInbound(params: {
    companyId: string;
    conversation: ConversationDetail;
    sourceMessageId: string;
    question: string;
    customer: Customer;
  }): Promise<{ generated: boolean; reason?: string; message?: Message }> {
    const { companyId, conversation, sourceMessageId, question, customer } = params;

    if (!env.AI_FEATURE_ENABLED) return { generated: false, reason: 'ai_disabled' };
    if (!env.AI_AUTO_REPLY_ENABLED) {
      return { generated: false, reason: 'auto_reply_disabled_env' };
    }
    if (conversation.aiMode !== 'ENABLED') {
      return { generated: false, reason: 'ai_paused' };
    }
    const settings = await aiSettingsService.get(companyId);
    if (!settings.autoReplyEnabled) {
      return { generated: false, reason: 'auto_reply_disabled_company' };
    }
    // Customer explicitly asked for a human -> pause AI, tell the customer,
    // and let an agent take over (configurable + extensible via keywords).
    if (
      settings.handoffOnRequest &&
      detectHandoffRequest(question, settings.handoffKeywords)
    ) {
      await this.requestHandoff(companyId, conversation.id, 'customer_request');
      try {
        await persistAiReply(
          companyId,
          conversation.id,
          customer.id,
          null,
          settings.humanHandoffMessage,
          null,
          null,
          'SYSTEM',
        );
      } catch (err) {
        // The handoff itself must survive a failed notice delivery.
        logger.warn('ai.handoff.noticeFailed', {
          companyId,
          conversationId: conversation.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      return { generated: false, reason: 'handoff_requested' };
    }

    try {
      const result = await runGeneration({
        companyId,
        conversationId: conversation.id,
        generationType: 'AUTO_REPLY',
        requestedByUserId: null,
        question,
        sourceMessageId,
        customer,
        includeHistory: true,
        allowHandoffSignal: settings.handoffOnLowConfidence,
      });
      const message = await persistAiReply(
        companyId,
        conversation.id,
        customer.id,
        result.generationId,
        result.text,
        null,
        result.attachment?.imageUrl ?? null,
      );
      // The model signalled it cannot help: the customer already received the
      // handoff message (result.text was replaced), now pause the AI.
      if (result.lowConfidence) {
        await this.requestHandoff(companyId, conversation.id, 'low_confidence');
        return { generated: true, reason: 'handoff_low_confidence', message };
      }
      return { generated: true, message };
    } catch (err) {
      // Provider/quota failure must NOT roll back the inbound message. It is
      // already recorded as a FAILED generation inside runGeneration.
      const reason = err instanceof AIError ? err.code : 'ai_error';
      logger.warn('ai.autoReply.skipped', { companyId, conversationId: conversation.id, reason });
      return { generated: false, reason };
    }
  },

  /** Change AI mode with role rules + activity. */
  async setMode(
    companyId: string,
    conversationId: string,
    actor: { id: string; role: UserRole },
    mode: AIConversationMode,
  ): Promise<ConversationDetail> {
    const conv = await conversationsRepository.findByIdScoped(companyId, conversationId);
    if (!conv) throw AppError.notFound('Conversation not found');

    // Resuming (ENABLED) is OWNER/ADMIN only; pausing is allowed for all roles.
    if (mode === 'ENABLED' && actor.role === 'AGENT') {
      throw AppError.forbidden('Only OWNER or ADMIN can resume AI');
    }

    if (conv.aiMode !== mode) {
      await prisma.$transaction(async (tx) => {
        await conversationsRepository.updateById(tx, conversationId, {
          aiMode: mode,
          aiPausedAt: mode === 'ENABLED' ? null : new Date(),
          aiPausedByUserId: mode === 'ENABLED' ? null : actor.id,
          // Returning the conversation to AI clears the handoff flag; the
          // audit trail lives in the activity log.
          ...(mode === 'ENABLED'
            ? { handoffRequestedAt: null, handoffReason: null }
            : {}),
        });
        await logActivity(tx, {
          companyId,
          conversationId,
          actorUserId: actor.id,
          activityType: 'AI_MODE_CHANGED',
          previousValue: { aiMode: conv.aiMode },
          newValue: { aiMode: mode },
        });
      });
    }
    const detail = await conversationsRepository.findDetail(companyId, conversationId);
    if (!detail) throw AppError.notFound('Conversation not found');
    return detail;
  },

  async listGenerations(
    companyId: string,
    page: number,
    limit: number,
    conversationId?: string,
  ) {
    const { items, total } = await aiRepository.listGenerations(
      companyId,
      page,
      limit,
      conversationId,
    );
    return {
      items: items.map(serializeGeneration),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async getGeneration(companyId: string, id: string) {
    const gen = await aiRepository.findGenerationScoped(companyId, id);
    if (!gen) throw AppError.notFound('Generation not found');
    return serializeGeneration(gen);
  },

  /**
   * Agent-facing reply suggestions: 1-3 alternative answers to the latest
   * customer message, generated in ONE provider call and split on a sentinel
   * line. Nothing is persisted as a Message — the agent sends or edits one.
   */
  async generateSuggestions(
    companyId: string,
    conversationId: string,
    userId: string,
    count: number,
  ): Promise<{ generationId: string; suggestions: string[] }> {
    const conv = await conversationsRepository.findByIdScoped(companyId, conversationId);
    if (!conv) throw AppError.notFound('Conversation not found');
    const inbound = await latestInbound(companyId, conversationId);
    if (!inbound) {
      throw AppError.badRequest('No customer message to respond to yet');
    }

    const result = await runGeneration({
      companyId,
      conversationId,
      generationType: 'SUGGESTION',
      requestedByUserId: userId,
      question: inbound.content,
      sourceMessageId: inbound.id,
      includeHistory: true,
      adjustment: `Write exactly ${count} alternative replies the support agent could send, each self-contained and ready to send as-is. Separate the replies with a line containing only "###". Do not number or label them.`,
    });

    const suggestions = result.text
      .split(/\n?\s*###\s*\n?/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, count);

    return {
      generationId: result.generationId,
      // A model that ignores the delimiter still yields one usable suggestion.
      suggestions: suggestions.length > 0 ? suggestions : [result.text.trim()],
    };
  },

  /**
   * Generate + store the post-conversation summary. Called automatically when
   * a conversation is resolved/closed and available on demand. Uses the
   * transcript only (no retrieval), and records a SUMMARY generation for
   * auditing/usage like every other AI call.
   */
  async generateConversationSummary(
    companyId: string,
    conversationId: string,
    requestedByUserId: string | null,
  ): Promise<{ summary: string; generatedAt: Date }> {
    const conv = await conversationsRepository.findByIdScoped(companyId, conversationId);
    if (!conv) throw AppError.notFound('Conversation not found');

    const rows = await aiRepository.recentHistory(companyId, conversationId, 50);
    if (rows.length === 0) {
      throw AppError.badRequest('There are no messages to summarize');
    }

    await aiUsageService.assertWithinQuota(companyId);
    const provider = getAIProvider();

    const companyName = await prisma.company
      .findUnique({ where: { id: companyId }, select: { name: true, displayName: true } })
      .then((c) => c?.displayName || c?.name || 'the company');

    const transcript = rows
      .map((r) => `${toHistoryTurn(r).senderLabel}: ${r.content}`)
      .join('\n');

    const generation = await aiRepository.createGeneration({
      companyId,
      conversationId,
      requestedByUserId,
      generationType: 'SUMMARY',
      status: 'PENDING',
      provider: provider.name,
      model: env.OPENAI_MODEL,
      promptVersion: PROMPT_VERSION,
      contextSummary: {
        transcriptMessageCount: rows.length,
      } as unknown as Prisma.InputJsonValue,
    });

    try {
      const providerResult = await provider.generateResponse({
        systemPrompt: aiPromptService.buildSummarySystemPrompt(companyName),
        messages: [{ role: 'user', content: `TRANSCRIPT:\n${transcript}` }],
        model: env.OPENAI_MODEL,
        maxOutputTokens: env.OPENAI_MAX_OUTPUT_TOKENS,
        temperature: 0.2,
        timeoutMs: env.OPENAI_TIMEOUT_MS,
        maxRetries: env.OPENAI_MAX_RETRIES,
      });

      const cost = estimateCostUsd(
        providerResult.model,
        providerResult.inputTokens,
        providerResult.outputTokens,
      );
      await aiUsageService.record(companyId, {
        inputTokens: providerResult.inputTokens ?? 0,
        outputTokens: providerResult.outputTokens ?? 0,
        totalTokens: providerResult.totalTokens ?? 0,
        estimatedCostUsd: cost ?? 0,
      });
      await aiRepository.updateGeneration(companyId, generation.id, {
        status: 'COMPLETED',
        inputTokenCount: providerResult.inputTokens,
        outputTokenCount: providerResult.outputTokens,
        totalTokenCount: providerResult.totalTokens,
        estimatedCostUsd: cost,
        latencyMs: providerResult.latencyMs,
        responseText: providerResult.text,
        providerResponseId: providerResult.providerResponseId,
        completedAt: new Date(),
      });

      const generatedAt = new Date();
      await prisma.conversation.updateMany({
        where: { id: conversationId, companyId },
        data: { aiSummary: providerResult.text, aiSummaryGeneratedAt: generatedAt },
      });

      return { summary: providerResult.text, generatedAt };
    } catch (err) {
      const code = err instanceof AIError ? err.code : 'AI_UNAVAILABLE';
      await aiRepository.updateGeneration(companyId, generation.id, {
        status: 'FAILED',
        failureCode: code,
        failureMessage:
          err instanceof AIError ? err.message : 'AI generation failed',
        failedAt: new Date(),
      });
      throw err;
    }
  },

  /**
   * Fire-and-forget wrapper used by the conversation lifecycle: summary
   * failures (AI disabled, quota, provider outage) never block or fail the
   * status change that triggered them.
   */
  async trySummarizeOnClose(
    companyId: string,
    conversationId: string,
    actorUserId: string | null,
  ): Promise<void> {
    if (!env.AI_FEATURE_ENABLED) return;
    try {
      await this.generateConversationSummary(
        companyId,
        conversationId,
        actorUserId,
      );
    } catch (err) {
      logger.warn('ai.summary.skipped', {
        companyId,
        conversationId,
        reason: err instanceof AIError ? err.code : 'error',
      });
    }
  },

  /** Pause AI + record a handoff request (used on customer handoff intent). */
  async requestHandoff(
    companyId: string,
    conversationId: string,
    reason: string,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await conversationsRepository.updateById(tx, conversationId, {
        aiMode: 'PAUSED',
        aiPausedAt: new Date(),
        handoffRequestedAt: new Date(),
        handoffReason: reason,
      });
      await logActivity(tx, {
        companyId,
        conversationId,
        actorUserId: null,
        activityType: 'AI_HANDOFF_REQUESTED',
        metadata: { reason },
      });
    });
  },
};
