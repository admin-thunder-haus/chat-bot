import type {
  ChannelAccount,
  ChannelActivity,
  ChannelActivityType,
  ChannelDelivery,
  ChannelType,
  ChannelWebhookEvent,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../config/prisma';

export interface ChannelAccountListFilters {
  channelType?: ChannelType;
  providerKey?: string;
  isEnabled?: boolean;
}

export interface ChannelActivityInput {
  companyId: string;
  channelAccountId?: string | null;
  conversationId?: string | null;
  actorUserId?: string | null;
  activityType: ChannelActivityType;
  metadata?: Prisma.InputJsonValue;
}

type Client = Prisma.TransactionClient | typeof prisma;

/** Tenant-scoped data-access for the channel framework. */
export const channelsRepository = {
  // --- Channel accounts ---------------------------------------------------

  create(
    companyId: string,
    data: Omit<Prisma.ChannelAccountUncheckedCreateInput, 'companyId'>,
  ): Promise<ChannelAccount> {
    return prisma.channelAccount.create({ data: { ...data, companyId } });
  },

  findByIdScoped(companyId: string, id: string): Promise<ChannelAccount | null> {
    return prisma.channelAccount.findFirst({ where: { id, companyId } });
  },

  /**
   * Resolve an account by its PUBLIC widget key (no JWT). The publicId itself is
   * the tenant resolver — everything downstream is scoped to `account.companyId`.
   * Returns null for unknown keys (never leaks existence beyond a generic 404).
   */
  findByPublicId(publicId: string): Promise<ChannelAccount | null> {
    return prisma.channelAccount.findFirst({ where: { publicId } });
  },

  /**
   * Resolve an account for a webhook (no JWT). Returns the full row INCLUDING
   * companyId so downstream processing is scoped to the owning tenant. Matched
   * by id + providerKey so a mismatched provider path never resolves.
   */
  findForWebhook(
    channelAccountId: string,
    providerKey: string,
  ): Promise<ChannelAccount | null> {
    return prisma.channelAccount.findFirst({
      where: { id: channelAccountId, providerKey },
    });
  },

  async list(
    companyId: string,
    filters: ChannelAccountListFilters = {},
  ): Promise<ChannelAccount[]> {
    const where: Prisma.ChannelAccountWhereInput = { companyId };
    if (filters.channelType) where.channelType = filters.channelType;
    if (filters.providerKey) where.providerKey = filters.providerKey;
    if (filters.isEnabled !== undefined) where.isEnabled = filters.isEnabled;
    return prisma.channelAccount.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  },

  async updateScoped(
    companyId: string,
    id: string,
    data: Prisma.ChannelAccountUpdateManyMutationInput,
  ): Promise<ChannelAccount | null> {
    const result = await prisma.channelAccount.updateMany({
      where: { id, companyId },
      data,
    });
    if (result.count === 0) return null;
    return this.findByIdScoped(companyId, id);
  },

  countAll(companyId: string): Promise<number> {
    return prisma.channelAccount.count({ where: { companyId } });
  },

  // --- Credentials --------------------------------------------------------

  upsertCredential(
    client: Client,
    companyId: string,
    channelAccountId: string,
    data: {
      encryptedPayload: string;
      encryptionVersion: string;
      keyVersion: string | null;
    },
  ): Promise<{ id: string }> {
    return client.channelCredential.upsert({
      where: { channelAccountId },
      create: {
        companyId,
        channelAccountId,
        encryptedPayload: data.encryptedPayload,
        encryptionVersion: data.encryptionVersion,
        keyVersion: data.keyVersion,
      },
      update: {
        encryptedPayload: data.encryptedPayload,
        encryptionVersion: data.encryptionVersion,
        keyVersion: data.keyVersion,
        rotatedAt: new Date(),
      },
      select: { id: true },
    });
  },

  /** Load a credential for backend integration use only (never serialized). */
  findCredential(
    companyId: string,
    channelAccountId: string,
  ): Promise<{
    encryptedPayload: string;
    encryptionVersion: string;
  } | null> {
    return prisma.channelCredential.findFirst({
      where: { companyId, channelAccountId },
      select: { encryptedPayload: true, encryptionVersion: true },
    });
  },

  // --- Webhook events -----------------------------------------------------

  findWebhookEvent(
    channelAccountId: string,
    providerKey: string,
    externalEventId: string,
  ): Promise<ChannelWebhookEvent | null> {
    return prisma.channelWebhookEvent.findFirst({
      where: { channelAccountId, providerKey, externalEventId },
    });
  },

  createWebhookEvent(
    data: Prisma.ChannelWebhookEventUncheckedCreateInput,
  ): Promise<ChannelWebhookEvent> {
    return prisma.channelWebhookEvent.create({ data });
  },

  updateWebhookEvent(
    id: string,
    data: Prisma.ChannelWebhookEventUncheckedUpdateInput,
  ): Promise<ChannelWebhookEvent> {
    return prisma.channelWebhookEvent.update({ where: { id }, data });
  },

  // --- Deliveries ---------------------------------------------------------

  createDelivery(
    client: Client,
    data: Prisma.ChannelDeliveryUncheckedCreateInput,
  ): Promise<ChannelDelivery> {
    return client.channelDelivery.create({ data });
  },

  updateDelivery(
    client: Client,
    id: string,
    data: Prisma.ChannelDeliveryUncheckedUpdateInput,
  ): Promise<ChannelDelivery> {
    return client.channelDelivery.update({ where: { id }, data });
  },

  findDeliveryByMessageId(
    companyId: string,
    messageId: string,
  ): Promise<ChannelDelivery | null> {
    return prisma.channelDelivery.findFirst({
      where: { companyId, messageId },
    });
  },

  findDeliveryByExternalMessageId(
    companyId: string,
    providerKey: string,
    externalMessageId: string,
  ): Promise<ChannelDelivery | null> {
    return prisma.channelDelivery.findFirst({
      where: { companyId, providerKey, externalMessageId },
    });
  },

  listDeliveriesForConversation(
    companyId: string,
    conversationId: string,
  ): Promise<ChannelDelivery[]> {
    return prisma.channelDelivery.findMany({
      where: {
        companyId,
        message: { conversationId },
      },
    });
  },

  findDeliveryById(
    companyId: string,
    id: string,
  ): Promise<ChannelDelivery | null> {
    return prisma.channelDelivery.findFirst({ where: { id, companyId } });
  },

  /**
   * Atomically claim a delivery for an attempt: flip QUEUED/PENDING -> SENDING
   * only if it is still eligible. Returns the number of rows updated (1 = we won
   * the claim, 0 = another worker/request already took it — race protection).
   */
  async claimDeliveryForAttempt(
    client: Client,
    id: string,
    data: Prisma.ChannelDeliveryUncheckedUpdateManyInput,
  ): Promise<number> {
    const res = await client.channelDelivery.updateMany({
      where: { id, status: { in: ['QUEUED', 'PENDING'] } },
      data,
    });
    return res.count;
  },

  /** QUEUED deliveries whose scheduled retry time has elapsed (queue-ready). */
  findDueDeliveries(
    now: Date,
    limit: number,
    companyId?: string,
  ): Promise<ChannelDelivery[]> {
    return prisma.channelDelivery.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        status: 'QUEUED',
        nextAttemptAt: { not: null, lte: now },
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
    });
  },

  /** Deliveries stuck in SENDING past a cutoff (crashed mid-attempt). */
  findStuckSending(
    olderThan: Date,
    limit: number,
    companyId?: string,
  ): Promise<ChannelDelivery[]> {
    return prisma.channelDelivery.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        status: 'SENDING',
        lastAttemptAt: { lt: olderThan },
      },
      take: limit,
    });
  },

  /** Re-queue a stuck SENDING delivery (guarded so it only affects SENDING). */
  async requeueStuck(id: string, now: Date): Promise<number> {
    const res = await prisma.channelDelivery.updateMany({
      where: { id, status: 'SENDING' },
      data: { status: 'QUEUED', nextAttemptAt: now },
    });
    return res.count;
  },

  // --- Delivery attempts (retry history, append-only) ---------------------

  createDeliveryAttempt(
    client: Client,
    data: Prisma.ChannelDeliveryAttemptUncheckedCreateInput,
  ) {
    return client.channelDeliveryAttempt.create({ data });
  },

  updateDeliveryAttempt(
    client: Client,
    id: string,
    data: Prisma.ChannelDeliveryAttemptUncheckedUpdateInput,
  ) {
    return client.channelDeliveryAttempt.update({ where: { id }, data });
  },

  listRecentAttempts(companyId: string, channelAccountId: string, limit: number) {
    return prisma.channelDeliveryAttempt.findMany({
      where: { companyId, channelAccountId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  attemptStatusCounts(companyId: string, channelAccountId: string) {
    return prisma.channelDeliveryAttempt.groupBy({
      by: ['status'],
      where: { companyId, channelAccountId },
      _count: { _all: true },
    });
  },

  // --- Health checks (history, append-only) -------------------------------

  createHealthCheck(
    client: Client,
    data: Prisma.ChannelHealthCheckUncheckedCreateInput,
  ) {
    return client.channelHealthCheck.create({ data });
  },

  listHealthHistory(companyId: string, channelAccountId: string, limit: number) {
    return prisma.channelHealthCheck.findMany({
      where: { companyId, channelAccountId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  // --- Diagnostics aggregates --------------------------------------------

  deliveryStatusCounts(companyId: string, channelAccountId: string) {
    return prisma.channelDelivery.groupBy({
      by: ['status'],
      where: { companyId, channelAccountId },
      _count: { _all: true },
    });
  },

  recentFailedDeliveries(
    companyId: string,
    channelAccountId: string,
    limit: number,
  ): Promise<ChannelDelivery[]> {
    return prisma.channelDelivery.findMany({
      where: { companyId, channelAccountId, status: { in: ['FAILED', 'EXPIRED'] } },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  },

  recentActivitiesByType(
    companyId: string,
    channelAccountId: string,
    types: ChannelActivityType[],
    limit: number,
  ): Promise<ChannelActivity[]> {
    return prisma.channelActivity.findMany({
      where: { companyId, channelAccountId, activityType: { in: types } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  // --- Channel activity (append-only) -------------------------------------

  logChannelActivity(
    client: Client,
    input: ChannelActivityInput,
  ): Promise<ChannelActivity> {
    return client.channelActivity.create({
      data: {
        companyId: input.companyId,
        channelAccountId: input.channelAccountId ?? null,
        conversationId: input.conversationId ?? null,
        actorUserId: input.actorUserId ?? null,
        activityType: input.activityType,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      },
    });
  },
};
