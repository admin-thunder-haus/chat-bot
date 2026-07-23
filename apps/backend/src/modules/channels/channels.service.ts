import { Prisma } from '@prisma/client';
import type { ChannelAccount } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';
import { isFakeChannelEnabled } from '../../config/env';
import { channelsRepository } from './channels.repository';
import { channelRegistry } from './channel-registry';
import { channelSecurityService } from './channel-security.service';
import { billingLimitsService } from '../billing/billing-limits.service';
import {
  serializeChannelAccount,
  type ChannelAccountView,
} from './channels.types';
import { readWebChatConfig } from './providers/webchat.config';
import { WEBCHAT_PROVIDER_KEY } from './providers/webchat-channel.provider';
import type {
  ChannelListQuery,
  CreateChannelAccountInput,
  ChannelStatusInput,
  UpdateChannelAccountInput,
  WebChatConfigInput,
} from './channels.validation';

const MAX_METADATA_BYTES = 4_000;

function assertMetadataSize(metadata: unknown): void {
  if (metadata === undefined) return;
  if (JSON.stringify(metadata).length > MAX_METADATA_BYTES) {
    throw AppError.badRequest('Validation failed', [
      { field: 'metadata', message: 'Metadata is too large' },
    ]);
  }
}

export const channelsService = {
  /** Safe provider catalog for the dashboard (registered + coming-soon). */
  listProviders(): ReturnType<typeof channelRegistry.catalog> {
    return channelRegistry.catalog();
  },

  async listAccounts(
    companyId: string,
    query: ChannelListQuery,
  ): Promise<ChannelAccountView[]> {
    const accounts = await channelsRepository.list(companyId, {
      channelType: query.channelType,
      providerKey: query.providerKey,
      isEnabled:
        query.enabled === undefined ? undefined : query.enabled === 'true',
    });
    return accounts.map(serializeChannelAccount);
  },

  async getAccount(
    companyId: string,
    id: string,
  ): Promise<ChannelAccountView> {
    const account = await channelsRepository.findByIdScoped(companyId, id);
    if (!account) throw AppError.notFound('Channel account not found');
    return serializeChannelAccount(account);
  },

  /** Read the full (defaulted) Web Chat config for an account. */
  async getWebChatConfig(companyId: string, id: string) {
    const account = await channelsRepository.findByIdScoped(companyId, id);
    if (!account || account.providerKey !== WEBCHAT_PROVIDER_KEY) {
      throw AppError.notFound('Web Chat channel not found');
    }
    return {
      publicId: account.publicId,
      config: readWebChatConfig(account.metadata),
    };
  },

  /** Update the Web Chat widget config (merged into metadata.webchat). */
  async updateWebChatConfig(
    companyId: string,
    id: string,
    actorUserId: string,
    input: WebChatConfigInput,
  ) {
    const account = await channelsRepository.findByIdScoped(companyId, id);
    if (!account || account.providerKey !== WEBCHAT_PROVIDER_KEY) {
      throw AppError.notFound('Web Chat channel not found');
    }
    const current = readWebChatConfig(account.metadata);
    const nextConfig = { ...current, ...input };
    const baseMetadata =
      account.metadata && typeof account.metadata === 'object'
        ? (account.metadata as Record<string, unknown>)
        : {};
    const nextMetadata = { ...baseMetadata, webchat: nextConfig };

    await prisma.$transaction(async (tx) => {
      await tx.channelAccount.updateMany({
        where: { id, companyId },
        data: { metadata: nextMetadata as Prisma.InputJsonValue },
      });
      await channelsRepository.logChannelActivity(tx, {
        companyId,
        channelAccountId: id,
        actorUserId,
        activityType: 'CHANNEL_ACCOUNT_UPDATED',
        metadata: { fields: Object.keys(input), section: 'webchat' },
      });
    });
    return { publicId: account.publicId, config: nextConfig };
  },

  async createAccount(
    companyId: string,
    actorUserId: string,
    input: CreateChannelAccountInput,
  ): Promise<ChannelAccountView> {
    assertMetadataSize(input.metadata);

    // Plan limit: connected (non-disconnected) channel accounts.
    await billingLimitsService.assertWithinLimit(
      companyId,
      'maxChannels',
      await prisma.channelAccount.count({
        where: { companyId, status: { not: 'DISCONNECTED' } },
      }),
    );

    // Only registered, usable providers can be connected. In Part 1 that is the
    // development fake provider only; real platforms are honest placeholders and
    // are rejected until their provider exists.
    const provider = channelRegistry.tryGet(input.providerKey);
    if (!provider) {
      const known = channelRegistry
        .catalog()
        .some((p) => p.key === input.providerKey);
      throw AppError.badRequest(
        known
          ? `Provider "${input.providerKey}" is not available yet`
          : `Unknown channel provider "${input.providerKey}"`,
      );
    }
    if (provider.developmentOnly && !isFakeChannelEnabled) {
      throw AppError.badRequest(
        `Provider "${input.providerKey}" is not available in this environment`,
      );
    }
    // Credentialed providers (e.g. WhatsApp) require secrets and MUST use their
    // dedicated connect endpoint — the generic create never touches credentials.
    if (provider.requiresCredentials) {
      throw AppError.badRequest(
        `Provider "${input.providerKey}" must be connected via its connect flow`,
      );
    }

    // Provider-specific one-time setup (generic hook — no platform branching
    // here). Web Chat mints a public widget key + default config; others no-op.
    const init = provider.initializeAccount?.({
      displayName: input.displayName,
    });
    const mergedMetadata = {
      ...(init?.metadata ?? {}),
      ...(input.metadata ?? {}),
    };

    const now = new Date();
    const account = await prisma.$transaction(async (tx) => {
      const created = await tx.channelAccount.create({
        data: {
          companyId,
          providerKey: provider.key,
          channelType: provider.channelType,
          displayName: input.displayName,
          externalAccountId: input.externalAccountId ?? null,
          externalPageId: input.externalPageId ?? null,
          publicId: init?.publicId ?? null,
          status: 'CONNECTED',
          connectionState: init?.connectionState ?? 'UNKNOWN',
          isEnabled: true,
          isDefault: input.isDefault ?? false,
          capabilities:
            provider.capabilities as unknown as Prisma.InputJsonValue,
          metadata:
            Object.keys(mergedMetadata).length > 0
              ? (mergedMetadata as Prisma.InputJsonValue)
              : undefined,
          connectedAt: now,
        },
      });
      await channelsRepository.logChannelActivity(tx, {
        companyId,
        channelAccountId: created.id,
        actorUserId,
        activityType: 'CHANNEL_ACCOUNT_CREATED',
        metadata: { providerKey: provider.key },
      });
      await channelsRepository.logChannelActivity(tx, {
        companyId,
        channelAccountId: created.id,
        actorUserId,
        activityType: 'CHANNEL_ACCOUNT_CONNECTED',
        metadata: { providerKey: provider.key },
      });
      return created;
    });

    return serializeChannelAccount(account);
  },

  /**
   * Connect a credentialed provider (e.g. WhatsApp). Generic by design: the
   * provider's `prepareConnection` hook validates the platform-specific payload
   * and splits it into the safe account shape + secret credentials; this method
   * creates the ChannelAccount and stores the credentials ENCRYPTED (AES-256-GCM)
   * in the same transaction. No platform-specific logic lives here, and the
   * returned view NEVER contains credentials.
   */
  async connectCredentialedProvider(
    companyId: string,
    actorUserId: string,
    providerKey: string,
    displayName: string,
    payload: Record<string, unknown>,
  ): Promise<ChannelAccountView> {
    // Plan limit: connected (non-disconnected) channel accounts.
    await billingLimitsService.assertWithinLimit(
      companyId,
      'maxChannels',
      await prisma.channelAccount.count({
        where: { companyId, status: { not: 'DISCONNECTED' } },
      }),
    );

    const provider = channelRegistry.tryGet(providerKey);
    if (!provider) {
      throw AppError.badRequest(`Unknown channel provider "${providerKey}"`);
    }
    if (!provider.requiresCredentials || !provider.prepareConnection) {
      throw AppError.badRequest(
        `Provider "${providerKey}" does not support credentialed connect`,
      );
    }
    // Credential storage requires the encryption key (Day 5 Part 1).
    if (!channelSecurityService.isConfigured()) {
      throw AppError.internal(
        'Credential encryption is not configured (CHANNEL_CREDENTIAL_ENCRYPTION_KEY missing)',
      );
    }

    const prep = provider.prepareConnection({ displayName, payload });
    const encrypted = channelSecurityService.encrypt(prep.secretCredentials);
    const now = new Date();

    let accountId: string;
    try {
      accountId = await prisma.$transaction(async (tx) => {
        const created = await tx.channelAccount.create({
          data: {
            companyId,
            providerKey: provider.key,
            channelType: provider.channelType,
            displayName,
            externalAccountId: prep.externalAccountId,
            externalPageId: prep.externalPageId,
            publicId: prep.publicId ?? null,
            status: 'CONNECTED',
            connectionState: prep.connectionState ?? 'UNKNOWN',
            isEnabled: true,
            capabilities:
              provider.capabilities as unknown as Prisma.InputJsonValue,
            metadata: (prep.metadata ?? undefined) as Prisma.InputJsonValue,
            connectedAt: now,
          },
        });
        await channelsRepository.upsertCredential(tx, companyId, created.id, {
          encryptedPayload: encrypted.encryptedPayload,
          encryptionVersion: encrypted.encryptionVersion,
          keyVersion: encrypted.keyVersion,
        });
        await channelsRepository.logChannelActivity(tx, {
          companyId,
          channelAccountId: created.id,
          actorUserId,
          activityType: 'CHANNEL_ACCOUNT_CREATED',
          metadata: { providerKey: provider.key },
        });
        await channelsRepository.logChannelActivity(tx, {
          companyId,
          channelAccountId: created.id,
          actorUserId,
          activityType: 'CHANNEL_ACCOUNT_CONNECTED',
          metadata: { providerKey: provider.key },
        });
        return created.id;
      });
    } catch (err) {
      // Duplicate (companyId, providerKey, externalAccountId) — e.g. the same
      // phone number connected twice.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw AppError.conflict('This account is already connected');
      }
      throw err;
    }

    const account = await channelsRepository.findByIdScoped(companyId, accountId);
    return serializeChannelAccount(account as ChannelAccount);
  },

  async updateAccount(
    companyId: string,
    id: string,
    actorUserId: string,
    input: UpdateChannelAccountInput,
  ): Promise<ChannelAccountView> {
    assertMetadataSize(input.metadata);
    const existing = await channelsRepository.findByIdScoped(companyId, id);
    if (!existing) throw AppError.notFound('Channel account not found');

    const data: Prisma.ChannelAccountUpdateManyMutationInput = {};
    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.isDefault !== undefined) data.isDefault = input.isDefault;
    if (input.metadata !== undefined) {
      data.metadata = input.metadata as Prisma.InputJsonValue;
    }

    const account = await prisma.$transaction(async (tx) => {
      await tx.channelAccount.updateMany({ where: { id, companyId }, data });
      await channelsRepository.logChannelActivity(tx, {
        companyId,
        channelAccountId: id,
        actorUserId,
        activityType: 'CHANNEL_ACCOUNT_UPDATED',
        metadata: { fields: Object.keys(data) },
      });
      return tx.channelAccount.findFirst({ where: { id, companyId } });
    });
    return serializeChannelAccount(account as ChannelAccount);
  },

  async setStatus(
    companyId: string,
    id: string,
    actorUserId: string,
    input: ChannelStatusInput,
  ): Promise<ChannelAccountView> {
    const existing = await channelsRepository.findByIdScoped(companyId, id);
    if (!existing) throw AppError.notFound('Channel account not found');

    const now = new Date();
    const data: Prisma.ChannelAccountUpdateManyMutationInput = {};
    if (input.isEnabled !== undefined) data.isEnabled = input.isEnabled;
    if (input.status !== undefined) {
      data.status = input.status;
      if (input.status === 'DISCONNECTED') {
        data.isEnabled = false;
        data.disconnectedAt = now;
        data.connectionState = 'UNAVAILABLE';
      }
      if (input.status === 'CONNECTED') {
        data.connectedAt = existing.connectedAt ?? now;
        data.disconnectedAt = null;
      }
    }

    const account = await prisma.$transaction(async (tx) => {
      await tx.channelAccount.updateMany({ where: { id, companyId }, data });
      if (input.status === 'DISCONNECTED') {
        await channelsRepository.logChannelActivity(tx, {
          companyId,
          channelAccountId: id,
          actorUserId,
          activityType: 'CHANNEL_ACCOUNT_DISCONNECTED',
        });
      } else if (input.status === 'CONNECTED') {
        await channelsRepository.logChannelActivity(tx, {
          companyId,
          channelAccountId: id,
          actorUserId,
          activityType: 'CHANNEL_ACCOUNT_CONNECTED',
        });
      } else {
        await channelsRepository.logChannelActivity(tx, {
          companyId,
          channelAccountId: id,
          actorUserId,
          activityType: 'CHANNEL_ACCOUNT_UPDATED',
          metadata: { isEnabled: input.isEnabled },
        });
      }
      return tx.channelAccount.findFirst({ where: { id, companyId } });
    });
    return serializeChannelAccount(account as ChannelAccount);
  },

  /**
   * Soft-disconnect: preserves all message/conversation history. The DELETE
   * route maps here — nothing is hard-deleted so the inbox stays intact.
   */
  async disconnect(
    companyId: string,
    id: string,
    actorUserId: string,
  ): Promise<ChannelAccountView> {
    const existing = await channelsRepository.findByIdScoped(companyId, id);
    if (!existing) throw AppError.notFound('Channel account not found');

    const now = new Date();
    const account = await prisma.$transaction(async (tx) => {
      await tx.channelAccount.updateMany({
        where: { id, companyId },
        data: {
          status: 'DISCONNECTED',
          isEnabled: false,
          connectionState: 'UNAVAILABLE',
          disconnectedAt: now,
        },
      });
      await channelsRepository.logChannelActivity(tx, {
        companyId,
        channelAccountId: id,
        actorUserId,
        activityType: 'CHANNEL_ACCOUNT_DISCONNECTED',
      });
      return tx.channelAccount.findFirst({ where: { id, companyId } });
    });
    return serializeChannelAccount(account as ChannelAccount);
  },

  /**
   * Hard-delete a channel account permanently. Encrypted credentials, deliveries,
   * delivery attempts, webhook events, and health checks are removed via DB
   * cascade; conversations are preserved (their channelAccountId is set NULL by
   * the FK). This frees the (companyId, providerKey, externalAccountId) unique
   * slot so the same account can be reconnected with fresh data. OWNER/ADMIN only.
   */
  async deletePermanently(
    companyId: string,
    id: string,
  ): Promise<void> {
    const existing = await channelsRepository.findByIdScoped(companyId, id);
    if (!existing) throw AppError.notFound('Channel account not found');
    // Tenant-scoped delete; cascades + SetNull are enforced by the schema FKs.
    await prisma.channelAccount.deleteMany({ where: { id, companyId } });
  },
};
