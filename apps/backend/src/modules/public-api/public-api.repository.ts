import type {
  ApiKey,
  OutboundWebhook,
  OutboundWebhookDelivery,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../config/prisma';

export type OutboundWebhookWithCount = Prisma.OutboundWebhookGetPayload<{
  include: { _count: { select: { deliveries: true } } };
}>;

/**
 * Data-access for the public-API surface: API keys, outbound webhooks and
 * their delivery log. Every tenant-facing query is scoped by companyId; the
 * one exception is the hash lookup used by the API-key auth middleware, where
 * the tenant is DERIVED from the key itself.
 */
export const publicApiRepository = {
  // --- API keys ---

  createApiKey(
    companyId: string,
    data: Omit<Prisma.ApiKeyUncheckedCreateInput, 'companyId'>,
  ): Promise<ApiKey> {
    return prisma.apiKey.create({ data: { ...data, companyId } });
  },

  listApiKeys(companyId: string): Promise<ApiKey[]> {
    return prisma.apiKey.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  },

  findApiKeyByIdScoped(companyId: string, id: string): Promise<ApiKey | null> {
    return prisma.apiKey.findFirst({ where: { id, companyId } });
  },

  /** Auth lookup: the SHA-256 hash is unique across all tenants. */
  findApiKeyByHash(keyHash: string): Promise<ApiKey | null> {
    return prisma.apiKey.findUnique({ where: { keyHash } });
  },

  async revokeApiKey(companyId: string, id: string): Promise<ApiKey | null> {
    await prisma.apiKey.updateMany({
      where: { id, companyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return this.findApiKeyByIdScoped(companyId, id);
  },

  async touchApiKey(id: string): Promise<void> {
    await prisma.apiKey.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  },

  // --- Outbound webhooks ---

  createWebhook(
    companyId: string,
    data: Omit<Prisma.OutboundWebhookUncheckedCreateInput, 'companyId'>,
  ): Promise<OutboundWebhook> {
    return prisma.outboundWebhook.create({ data: { ...data, companyId } });
  },

  listWebhooks(companyId: string): Promise<OutboundWebhookWithCount[]> {
    return prisma.outboundWebhook.findMany({
      where: { companyId },
      include: { _count: { select: { deliveries: true } } },
      orderBy: { createdAt: 'desc' },
    });
  },

  findWebhookScoped(
    companyId: string,
    id: string,
  ): Promise<OutboundWebhook | null> {
    return prisma.outboundWebhook.findFirst({ where: { id, companyId } });
  },

  async updateWebhook(
    companyId: string,
    id: string,
    data: Prisma.OutboundWebhookUpdateManyMutationInput,
  ): Promise<OutboundWebhook | null> {
    const result = await prisma.outboundWebhook.updateMany({
      where: { id, companyId },
      data,
    });
    if (result.count === 0) return null;
    return this.findWebhookScoped(companyId, id);
  },

  /** Physical delete, scoped. Returns number of rows removed (0 or 1). */
  async removeWebhook(companyId: string, id: string): Promise<number> {
    const result = await prisma.outboundWebhook.deleteMany({
      where: { id, companyId },
    });
    return result.count;
  },

  /** Active webhooks of a company subscribed to the given event type. */
  findActiveSubscribed(
    companyId: string,
    eventType: string,
  ): Promise<OutboundWebhook[]> {
    return prisma.outboundWebhook.findMany({
      where: { companyId, isActive: true, events: { has: eventType } },
    });
  },

  // --- Delivery log ---

  createDelivery(
    companyId: string,
    data: Omit<Prisma.OutboundWebhookDeliveryUncheckedCreateInput, 'companyId'>,
  ): Promise<OutboundWebhookDelivery> {
    return prisma.outboundWebhookDelivery.create({
      data: { ...data, companyId },
    });
  },

  listDeliveries(
    companyId: string,
    webhookId: string,
    limit: number,
  ): Promise<OutboundWebhookDelivery[]> {
    return prisma.outboundWebhookDelivery.findMany({
      where: { companyId, webhookId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  /** Delivery succeeded: consecutive-failure streak resets. */
  async recordWebhookSuccess(webhookId: string): Promise<void> {
    await prisma.outboundWebhook.update({
      where: { id: webhookId },
      data: { failureCount: 0, lastSuccessAt: new Date() },
    });
  },

  /**
   * Delivery failed after all retries: bump the consecutive-failure counter
   * and auto-disable the endpoint once it reaches the threshold.
   */
  async recordWebhookFailure(
    webhookId: string,
    disableAfter: number,
  ): Promise<void> {
    const updated = await prisma.outboundWebhook.update({
      where: { id: webhookId },
      data: { failureCount: { increment: 1 }, lastFailureAt: new Date() },
    });
    if (updated.failureCount >= disableAfter && updated.isActive) {
      await prisma.outboundWebhook.update({
        where: { id: webhookId },
        data: { isActive: false },
      });
    }
  },
};
