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
  PROMPT_VERSION,
} from './ai-prompt.service';
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
];

export function detectHandoffRequest(text: string): boolean {
  return HANDOFF_PATTERNS.some((re) => re.test(text));
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

  const systemPrompt = aiPromptService.buildSystemPrompt({
    companyName: ctx.companyName,
    contextText: ctx.contextText,
    settings,
    injectionSuspected,
    adjustment: input.adjustment,
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

    return {
      generationId: generation.id,
      generationType: input.generationType,
      text: providerResult.text,
      model: providerResult.model,
      provider: providerResult.provider,
      inputTokens: providerResult.inputTokens,
      outputTokens: providerResult.outputTokens,
      totalTokens: providerResult.totalTokens,
      estimatedCostUsd: cost,
      latencyMs: providerResult.latencyMs,
      handoffRequested: injectionSuspected || detectHandoffRequest(input.question),
      usedFallback: retrieval.usedFallback,
      contextSummary,
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
  generationId: string,
  text: string,
  senderUserId: string | null,
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
    const message = await channelDeliveryService.dispatchOutbound({
      companyId,
      conversation: conv,
      account,
      senderUserId,
      senderType: 'AI',
      content: text,
      actorUserId: senderUserId,
    });
    await prisma.aIResponseGeneration.updateMany({
      where: { id: generationId, companyId },
      data: { generatedMessageId: message.id },
    });
    return message;
  }

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const message = await messagesRepository.create(tx, companyId, {
      conversationId,
      customerId,
      senderUserId,
      direction: 'OUTBOUND',
      senderType: 'AI',
      content: text,
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
      metadata: { ai: true, generationId, messageId: message.id },
    });
    await tx.aIResponseGeneration.updateMany({
      where: { id: generationId, companyId },
      data: { generatedMessageId: message.id },
    });
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
    // Customer explicitly asked for a human -> pause AI, no auto reply.
    if (detectHandoffRequest(question)) {
      await this.requestHandoff(companyId, conversation.id, 'customer_request');
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
      });
      const message = await persistAiReply(
        companyId,
        conversation.id,
        customer.id,
        result.generationId,
        result.text,
        null,
      );
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
