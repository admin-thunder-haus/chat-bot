import { Prisma } from '@prisma/client';
import type {
  ChannelAccount,
  ChannelDelivery,
  ChannelDeliveryStatus,
  Conversation,
  Message,
  MessageSenderType,
} from '@prisma/client';
import { prisma } from '../../config/prisma';
import { logger } from '../../utils/logger';
import { logActivity } from '../../utils/activity';
import { messagesRepository } from '../messages/messages.repository';
import { conversationsRepository } from '../conversations/conversations.repository';
import { channelsRepository } from './channels.repository';
import { channelRegistry } from './channel-registry';
import { channelRetryService } from './channel-retry.service';
import { channelHealthService } from './channel-health.service';
import { channelCredentialsService } from './channel-credentials.service';

/** Terminal delivery states — never re-attempted or advanced by callbacks. */
const TERMINAL: ChannelDeliveryStatus[] = [
  'FAILED',
  'EXPIRED',
  'CANCELLED',
];

/** Happy-path progression rank for monotonic status updates. */
const PROGRESS_RANK: Record<ChannelDeliveryStatus, number> = {
  PENDING: 0,
  QUEUED: 0,
  SENDING: 1,
  SENT: 2,
  DELIVERED: 3,
  READ: 4,
  FAILED: -1,
  EXPIRED: -1,
  CANCELLED: -1,
  UNKNOWN: -1,
};

export interface DispatchOutboundParams {
  companyId: string;
  conversation: Conversation;
  account: ChannelAccount;
  senderUserId: string | null;
  senderType: MessageSenderType;
  content: string;
  /**
   * Optional image attachment. Callers must gate on the provider's
   * `mediaMessages` capability; when set, the message is persisted as IMAGE
   * and the provider sends the image with `content` as its caption.
   */
  mediaUrl?: string | null;
  replyToMessageId?: string | null;
  actorUserId?: string | null;
}

export interface AttemptResult {
  status: 'sent' | 'retry_scheduled' | 'failed' | 'expired' | 'skipped';
  deliveryId: string;
  attemptNumber?: number;
  reason?: string;
}

/**
 * Central, provider-independent delivery engine (Day 5 Part 2). It owns the
 * outbound delivery lifecycle: enqueue -> attempt -> (retry | terminal), records
 * every attempt, folds outcomes into channel health, and applies provider
 * status callbacks monotonically.
 *
 * Queue-ready by design: `attemptDelivery` claims work atomically and
 * `runDueRetries` is the single entry point a future Part 3 worker/cron calls.
 * There is NO queue/Redis/worker here — only the architecture that supports one.
 */
export const channelDeliveryService = {
  /**
   * Provider outbound path: persist the message (PENDING) + a QUEUED delivery,
   * then run the first attempt inline. Manual/local sends never reach here.
   */
  async dispatchOutbound(params: DispatchOutboundParams): Promise<Message> {
    const { companyId, conversation, account } = params;
    const now = new Date();
    const policy = channelRetryService.policy();

    const { messageId, deliveryId } = await prisma.$transaction(async (tx) => {
      const message = await messagesRepository.create(tx, companyId, {
        conversationId: conversation.id,
        customerId: conversation.customerId,
        senderUserId: params.senderUserId,
        direction: 'OUTBOUND',
        senderType: params.senderType,
        contentType: params.mediaUrl ? 'IMAGE' : 'TEXT',
        content: params.content,
        mediaUrl: params.mediaUrl ?? null,
        status: 'PENDING',
        replyToMessageId: params.replyToMessageId ?? null,
      });
      await conversationsRepository.updateById(tx, conversation.id, {
        lastMessageAt: now,
        lastOutboundMessageAt: now,
      });
      await logActivity(tx, {
        companyId,
        conversationId: conversation.id,
        actorUserId: params.senderUserId,
        activityType: 'MESSAGE_SENT',
        metadata: { messageId: message.id, viaProvider: true },
      });
      const delivery = await channelsRepository.createDelivery(tx, {
        companyId,
        channelAccountId: account.id,
        messageId: message.id,
        providerKey: account.providerKey,
        status: 'QUEUED',
        maxAttempts: policy.maxAttempts,
        requestedAt: now,
        expiresAt: channelRetryService.expiresAt(now),
        idempotencyKey: `out-${message.id}`,
      });
      return { messageId: message.id, deliveryId: delivery.id };
    });

    await this.attemptDelivery(companyId, deliveryId, {
      actorUserId: params.actorUserId ?? params.senderUserId,
    });

    const message = await prisma.message.findFirst({
      where: { id: messageId, companyId },
    });
    return message as Message;
  },

  /**
   * Run one delivery attempt. Atomically claims the delivery (QUEUED/PENDING ->
   * SENDING) so concurrent callers/workers never double-send. Classifies the
   * outcome, schedules a retry (temporary + attempts remain) or finalizes
   * (success / permanent / exhausted), records the attempt + health, and logs
   * activity. Never throws for provider failures.
   */
  async attemptDelivery(
    companyId: string,
    deliveryId: string,
    opts: { actorUserId?: string | null; force?: boolean } = {},
  ): Promise<AttemptResult> {
    const delivery = await channelsRepository.findDeliveryById(
      companyId,
      deliveryId,
    );
    if (!delivery) return { status: 'skipped', deliveryId, reason: 'not_found' };

    const now = new Date();

    // TTL expiry: never keep retrying past the delivery's lifetime.
    if (
      delivery.expiresAt &&
      delivery.expiresAt <= now &&
      !TERMINAL.includes(delivery.status)
    ) {
      await this.expireDelivery(companyId, delivery, opts.actorUserId ?? null);
      return { status: 'expired', deliveryId };
    }

    // For a manual retry of a terminal FAILED delivery, re-queue it first.
    if (opts.force && delivery.status === 'FAILED') {
      await channelsRepository.updateDelivery(prisma, deliveryId, {
        status: 'QUEUED',
        nextAttemptAt: now,
        maxAttempts: Math.max(delivery.maxAttempts, delivery.attemptCount + 1),
      });
    }

    const attemptNumber = delivery.attemptCount + 1;

    // Atomically claim: QUEUED/PENDING -> SENDING. count 0 => raced/ineligible.
    const claimed = await channelsRepository.claimDeliveryForAttempt(
      prisma,
      deliveryId,
      {
        status: 'SENDING',
        lastAttemptAt: now,
        attemptCount: attemptNumber,
      },
    );
    if (claimed === 0) {
      return { status: 'skipped', deliveryId, reason: 'not_eligible' };
    }

    // Resolve account + provider. A misconfiguration is a permanent failure.
    const account = await channelsRepository.findByIdScoped(
      companyId,
      delivery.channelAccountId,
    );
    const provider = channelRegistry.tryGet(delivery.providerKey);
    if (
      !account ||
      !provider ||
      !account.isEnabled ||
      !provider.capabilities.outboundMessaging
    ) {
      await this.finalizeFailure(companyId, delivery, account, attemptNumber, {
        failureType: 'PERMANENT',
        failureCode: 'PROVIDER_UNAVAILABLE',
        failureReason: 'Channel provider is unavailable',
        latencyMs: 0,
        startedAt: now,
        actorUserId: opts.actorUserId ?? null,
      });
      return { status: 'failed', deliveryId, attemptNumber, reason: 'provider_unavailable' };
    }

    // Load the message content + recipient identifiers (safe — no credentials).
    const message = await prisma.message.findFirst({
      where: { id: delivery.messageId, companyId },
      select: {
        content: true,
        mediaUrl: true,
        customer: { select: { externalId: true } },
        conversation: { select: { externalConversationId: true } },
      },
    });

    // Resolve encrypted credentials only for providers that need them (WhatsApp).
    // Web Chat / fake ignore this (credential-free), so nothing is decrypted.
    const credentials = provider.requiresCredentials
      ? await channelCredentialsService.load(companyId, account.id)
      : null;

    const startedAt = new Date();
    let success = false;
    let externalMessageId: string | null = null;
    let providerMetadata: Prisma.InputJsonValue | undefined;
    let failureType: 'TEMPORARY' | 'PERMANENT' = 'TEMPORARY';
    let failureCode: string | null = null;
    let failureReason: string | null = null;

    try {
      const result = await provider.sendMessage({
        channelType: account.channelType,
        externalAccountId: account.externalAccountId,
        externalCustomerId: message?.customer?.externalId ?? null,
        externalConversationId:
          message?.conversation?.externalConversationId ?? null,
        replyToExternalMessageId: null,
        text: message?.content ?? '',
        mediaUrl: message?.mediaUrl ?? null,
        attemptNumber,
        credentials,
      });
      if (result.status === 'failed') {
        failureType = result.retryable ? 'TEMPORARY' : 'PERMANENT';
        failureCode = result.failureCode ?? 'SEND_FAILED';
        failureReason = result.failureReason ?? 'Provider failed to send';
      } else {
        success = true;
        externalMessageId = result.externalMessageId;
        providerMetadata =
          (result.providerMetadata ?? undefined) as Prisma.InputJsonValue | undefined;
      }
    } catch (err) {
      // A thrown exception is treated as a transient failure (network, timeout).
      failureType = 'TEMPORARY';
      failureCode = 'SEND_EXCEPTION';
      failureReason = 'Delivery attempt raised an error';
      logger.warn('channel.delivery.exception', {
        companyId,
        deliveryId,
        attemptNumber,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
    const latencyMs = Date.now() - startedAt.getTime();

    if (success) {
      await this.finalizeSuccess(companyId, delivery, account, attemptNumber, {
        externalMessageId,
        providerMetadata,
        latencyMs,
        startedAt,
        actorUserId: opts.actorUserId ?? null,
      });
      return { status: 'sent', deliveryId, attemptNumber };
    }

    const canRetry = channelRetryService.isRetryable(
      failureType,
      attemptNumber,
      delivery.maxAttempts,
    );
    if (canRetry) {
      await this.scheduleRetry(companyId, delivery, account, attemptNumber, {
        failureCode: failureCode ?? 'SEND_FAILED',
        failureReason: failureReason ?? 'Provider failed to send',
        latencyMs,
        startedAt,
        actorUserId: opts.actorUserId ?? null,
      });
      return { status: 'retry_scheduled', deliveryId, attemptNumber };
    }

    await this.finalizeFailure(companyId, delivery, account, attemptNumber, {
      failureType,
      failureCode: failureCode ?? 'SEND_FAILED',
      failureReason: failureReason ?? 'Provider failed to send',
      latencyMs,
      startedAt,
      actorUserId: opts.actorUserId ?? null,
    });
    return { status: 'failed', deliveryId, attemptNumber, reason: failureCode ?? undefined };
  },

  // --- Terminal / retry transitions (each atomic) -------------------------

  async finalizeSuccess(
    companyId: string,
    delivery: ChannelDelivery,
    account: ChannelAccount,
    attemptNumber: number,
    o: {
      externalMessageId: string | null;
      providerMetadata: Prisma.InputJsonValue | undefined;
      latencyMs: number;
      startedAt: Date;
      actorUserId: string | null;
    },
  ): Promise<void> {
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await channelsRepository.updateDelivery(tx, delivery.id, {
        status: 'SENT',
        sentAt: now,
        externalMessageId: o.externalMessageId,
        failureType: 'NONE',
        failureCode: null,
        failureMessage: null,
        nextAttemptAt: null,
        ...(o.providerMetadata !== undefined
          ? { providerMetadata: o.providerMetadata }
          : {}),
      });
      await tx.message.update({
        where: { id: delivery.messageId },
        data: { status: 'SENT', sentAt: now, externalMessageId: o.externalMessageId },
      });
      await channelsRepository.createDeliveryAttempt(tx, {
        companyId,
        channelAccountId: account.id,
        deliveryId: delivery.id,
        attemptNumber,
        status: 'SUCCESS',
        providerKey: delivery.providerKey,
        failureType: 'NONE',
        latencyMs: o.latencyMs,
        startedAt: o.startedAt,
        completedAt: now,
      });
      const transition = await channelHealthService.recordDeliveryOutcome(
        tx,
        account,
        { success: true, latencyMs: o.latencyMs },
      );
      await channelsRepository.logChannelActivity(tx, {
        companyId,
        channelAccountId: account.id,
        activityType: 'CHANNEL_MESSAGE_SENT',
        metadata: { deliveryId: delivery.id, attemptNumber, externalMessageId: o.externalMessageId },
      });
      await channelsRepository.logChannelActivity(tx, {
        companyId,
        channelAccountId: account.id,
        activityType: 'DELIVERY_STATUS_CHANGED',
        metadata: { deliveryId: delivery.id, status: 'SENT' },
      });
      if (attemptNumber > 1) {
        await channelsRepository.logChannelActivity(tx, {
          companyId,
          channelAccountId: account.id,
          activityType: 'DELIVERY_RECOVERED',
          metadata: { deliveryId: delivery.id, attemptNumber },
        });
      }
      if (transition.recovered) {
        await channelsRepository.logChannelActivity(tx, {
          companyId,
          channelAccountId: account.id,
          activityType: 'CHANNEL_RECOVERED',
          metadata: { from: transition.previousState, to: transition.newState },
        });
      }
    });
  },

  async scheduleRetry(
    companyId: string,
    delivery: ChannelDelivery,
    account: ChannelAccount,
    attemptNumber: number,
    o: {
      failureCode: string;
      failureReason: string;
      latencyMs: number;
      startedAt: Date;
      actorUserId: string | null;
    },
  ): Promise<void> {
    const now = new Date();
    const nextAttemptAt = channelRetryService.nextAttemptAt(attemptNumber, now);
    await prisma.$transaction(async (tx) => {
      await channelsRepository.updateDelivery(tx, delivery.id, {
        status: 'QUEUED',
        failureType: 'TEMPORARY',
        failureCode: o.failureCode,
        failureMessage: o.failureReason,
        nextAttemptAt,
      });
      // Message stays PENDING while a retry is scheduled.
      await channelsRepository.createDeliveryAttempt(tx, {
        companyId,
        channelAccountId: account.id,
        deliveryId: delivery.id,
        attemptNumber,
        status: 'TEMPORARY_FAILURE',
        providerKey: delivery.providerKey,
        failureType: 'TEMPORARY',
        errorCode: o.failureCode,
        errorMessage: o.failureReason,
        latencyMs: o.latencyMs,
        startedAt: o.startedAt,
        completedAt: now,
      });
      const transition = await channelHealthService.recordDeliveryOutcome(
        tx,
        account,
        { success: false, latencyMs: o.latencyMs, errorCode: o.failureCode, errorMessage: o.failureReason },
      );
      await channelsRepository.logChannelActivity(tx, {
        companyId,
        channelAccountId: account.id,
        activityType: 'DELIVERY_RETRY_SCHEDULED',
        metadata: {
          deliveryId: delivery.id,
          attemptNumber,
          nextAttemptAt: nextAttemptAt.toISOString(),
          failureCode: o.failureCode,
        },
      });
      if (transition.degraded) {
        await channelsRepository.logChannelActivity(tx, {
          companyId,
          channelAccountId: account.id,
          activityType: 'CHANNEL_DEGRADED',
          metadata: { from: transition.previousState, to: transition.newState },
        });
      }
    });
  },

  async finalizeFailure(
    companyId: string,
    delivery: ChannelDelivery,
    account: ChannelAccount | null,
    attemptNumber: number,
    o: {
      failureType: 'TEMPORARY' | 'PERMANENT';
      failureCode: string;
      failureReason: string;
      latencyMs: number;
      startedAt: Date;
      actorUserId: string | null;
    },
  ): Promise<void> {
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await channelsRepository.updateDelivery(tx, delivery.id, {
        status: 'FAILED',
        failedAt: now,
        failureType: o.failureType,
        failureCode: o.failureCode,
        failureMessage: o.failureReason,
        nextAttemptAt: null,
      });
      await tx.message.update({
        where: { id: delivery.messageId },
        data: { status: 'FAILED', failedAt: now, failureReason: o.failureCode },
      });
      if (account) {
        await channelsRepository.createDeliveryAttempt(tx, {
          companyId,
          channelAccountId: account.id,
          deliveryId: delivery.id,
          attemptNumber,
          status:
            o.failureType === 'PERMANENT'
              ? 'PERMANENT_FAILURE'
              : 'TEMPORARY_FAILURE',
          providerKey: delivery.providerKey,
          failureType: o.failureType,
          errorCode: o.failureCode,
          errorMessage: o.failureReason,
          latencyMs: o.latencyMs,
          startedAt: o.startedAt,
          completedAt: now,
        });
        const transition = await channelHealthService.recordDeliveryOutcome(
          tx,
          account,
          { success: false, latencyMs: o.latencyMs, errorCode: o.failureCode, errorMessage: o.failureReason },
        );
        if (transition.degraded) {
          await channelsRepository.logChannelActivity(tx, {
            companyId,
            channelAccountId: account.id,
            activityType: 'CHANNEL_DEGRADED',
            metadata: { from: transition.previousState, to: transition.newState },
          });
        }
      }
      await channelsRepository.logChannelActivity(tx, {
        companyId,
        channelAccountId: account?.id ?? delivery.channelAccountId,
        activityType: 'CHANNEL_MESSAGE_FAILED',
        metadata: {
          deliveryId: delivery.id,
          attemptNumber,
          failureCode: o.failureCode,
          failureType: o.failureType,
        },
      });
    });
  },

  async expireDelivery(
    companyId: string,
    delivery: ChannelDelivery,
    actorUserId: string | null,
  ): Promise<void> {
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await channelsRepository.updateDelivery(tx, delivery.id, {
        status: 'EXPIRED',
        failedAt: now,
        failureType: 'PERMANENT',
        failureCode: 'EXPIRED',
        failureMessage: 'Delivery expired before it could be sent',
        nextAttemptAt: null,
      });
      await tx.message.update({
        where: { id: delivery.messageId },
        data: { status: 'FAILED', failedAt: now, failureReason: 'EXPIRED' },
      });
      await channelsRepository.logChannelActivity(tx, {
        companyId,
        channelAccountId: delivery.channelAccountId,
        actorUserId,
        activityType: 'DELIVERY_EXPIRED',
        metadata: { deliveryId: delivery.id },
      });
    });
  },

  // --- Queue-ready entry points -------------------------------------------

  /**
   * Process deliveries whose scheduled retry time has elapsed. This is the ONE
   * function a future worker/cron will call — there is no scheduler here yet.
   */
  async runDueRetries(
    companyId?: string,
    limit = 50,
  ): Promise<{ processed: number; results: AttemptResult[] }> {
    const due = await channelsRepository.findDueDeliveries(
      new Date(),
      limit,
      companyId,
    );
    const results: AttemptResult[] = [];
    for (const d of due) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await this.attemptDelivery(d.companyId, d.id));
    }
    return { processed: results.length, results };
  },

  /**
   * Crash recovery: re-queue deliveries stuck in SENDING (a process died between
   * claiming and finalizing). The atomic claim guarantees no double-send, so
   * re-queuing is safe. Queue-ready — a Part 3 worker calls this periodically.
   */
  async recoverStuckDeliveries(
    thresholdMs = 60_000,
    companyId?: string,
    limit = 50,
  ): Promise<{ recovered: number }> {
    const cutoff = new Date(Date.now() - thresholdMs);
    const now = new Date();
    const stuck = await channelsRepository.findStuckSending(
      cutoff,
      limit,
      companyId,
    );
    let recovered = 0;
    for (const d of stuck) {
      // eslint-disable-next-line no-await-in-loop
      recovered += await channelsRepository.requeueStuck(d.id, now);
    }
    return { recovered };
  },

  /** Admin failure-recovery: force a fresh attempt on a FAILED/QUEUED delivery. */
  async manualRetry(
    companyId: string,
    deliveryId: string,
    actorUserId: string,
  ): Promise<AttemptResult> {
    const delivery = await channelsRepository.findDeliveryById(
      companyId,
      deliveryId,
    );
    if (!delivery) {
      return { status: 'skipped', deliveryId, reason: 'not_found' };
    }
    if (['SENT', 'DELIVERED', 'READ'].includes(delivery.status)) {
      return { status: 'skipped', deliveryId, reason: 'already_delivered' };
    }
    return this.attemptDelivery(companyId, deliveryId, {
      actorUserId,
      force: true,
    });
  },

  // --- Provider status callbacks (monotonic, idempotent) ------------------

  /**
   * Apply a provider delivery/read status callback. Monotonic: only advances the
   * happy path (never regresses), ignores duplicate/out-of-order/late callbacks,
   * and never resurrects a terminal delivery — so repeated or lost callbacks are
   * safe.
   */
  async applyExternalStatus(
    companyId: string,
    delivery: ChannelDelivery,
    incoming: 'sent' | 'delivered' | 'read' | 'failed',
    timestamp: Date,
  ): Promise<{ applied: boolean; status: ChannelDeliveryStatus }> {
    if (TERMINAL.includes(delivery.status)) {
      return { applied: false, status: delivery.status };
    }

    if (incoming === 'failed') {
      // Only a not-yet-confirmed message can be reported failed by a callback.
      if (PROGRESS_RANK[delivery.status] >= PROGRESS_RANK.DELIVERED) {
        return { applied: false, status: delivery.status };
      }
      await prisma.$transaction(async (tx) => {
        await channelsRepository.updateDelivery(tx, delivery.id, {
          status: 'FAILED',
          failedAt: timestamp,
          failureType: 'PERMANENT',
          failureCode: 'PROVIDER_REPORTED_FAILED',
          failureMessage: 'Provider reported the message as failed',
        });
        await tx.message.update({
          where: { id: delivery.messageId },
          data: { status: 'FAILED', failedAt: timestamp },
        });
        await channelsRepository.logChannelActivity(tx, {
          companyId,
          channelAccountId: delivery.channelAccountId,
          activityType: 'DELIVERY_STATUS_CHANGED',
          metadata: { deliveryId: delivery.id, status: 'FAILED' },
        });
      });
      return { applied: true, status: 'FAILED' };
    }

    const target: ChannelDeliveryStatus =
      incoming === 'read'
        ? 'READ'
        : incoming === 'delivered'
          ? 'DELIVERED'
          : 'SENT';
    // Idempotency / ordering: never move backwards (dupes + out-of-order safe).
    if (PROGRESS_RANK[target] <= PROGRESS_RANK[delivery.status]) {
      return { applied: false, status: delivery.status };
    }

    const messageStatus =
      target === 'READ' ? 'READ' : target === 'DELIVERED' ? 'DELIVERED' : 'SENT';
    await prisma.$transaction(async (tx) => {
      await channelsRepository.updateDelivery(tx, delivery.id, {
        status: target,
        ...(target === 'SENT' && !delivery.sentAt ? { sentAt: timestamp } : {}),
        ...(target === 'DELIVERED' ? { deliveredAt: timestamp } : {}),
        ...(target === 'READ' ? { readAt: timestamp } : {}),
      });
      await tx.message.update({
        where: { id: delivery.messageId },
        data: { status: messageStatus },
      });
      await channelsRepository.logChannelActivity(tx, {
        companyId,
        channelAccountId: delivery.channelAccountId,
        activityType: 'DELIVERY_STATUS_CHANGED',
        metadata: { deliveryId: delivery.id, status: target },
      });
    });
    return { applied: true, status: target };
  },
};
