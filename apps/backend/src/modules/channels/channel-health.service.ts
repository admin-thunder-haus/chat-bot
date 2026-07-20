import type {
  ChannelAccount,
  ChannelConnectionState,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import { channelsRepository } from './channels.repository';
import { channelRegistry } from './channel-registry';
import { channelCredentialsService } from './channel-credentials.service';
import {
  serializeChannelAccount,
  type ChannelAccountView,
} from './channels.types';

/** Score thresholds for deriving a connection state from the health score. */
const HEALTHY_MIN = 70;
const DEGRADED_MIN = 30;
/** Score deltas applied per delivery outcome. */
const SUCCESS_DELTA = 20;
const FAILURE_DELTA = 30;

function isHealthyState(s: ChannelConnectionState): boolean {
  return s === 'HEALTHY';
}
function isUnhealthyState(s: ChannelConnectionState): boolean {
  return s === 'DEGRADED' || s === 'UNAVAILABLE' || s === 'AUTH_EXPIRED';
}
/** A genuine recovery is unhealthy -> healthy (UNKNOWN start does not count). */
function isRecovery(
  prev: ChannelConnectionState,
  next: ChannelConnectionState,
): boolean {
  return isUnhealthyState(prev) && isHealthyState(next);
}
/** A genuine degradation is healthy -> unhealthy. */
function isDegradation(
  prev: ChannelConnectionState,
  next: ChannelConnectionState,
): boolean {
  return isHealthyState(prev) && isUnhealthyState(next);
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Delivery-derived connection state from a health score. */
function stateFromScore(score: number): ChannelConnectionState {
  if (score >= HEALTHY_MIN) return 'HEALTHY';
  if (score >= DEGRADED_MIN) return 'DEGRADED';
  return 'UNAVAILABLE';
}

export interface DeliveryOutcome {
  success: boolean;
  latencyMs?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface HealthTransition {
  previousState: ChannelConnectionState;
  newState: ChannelConnectionState;
  degraded: boolean;
  recovered: boolean;
  healthScore: number;
}

/**
 * Channel connection-health service (Part 2). Two health signals feed one model:
 * manual provider probes and real delivery outcomes. Both update a rolling
 * health score + connection state, are recorded in an append-only history, and
 * surface degradation/recovery — without ever exposing provider internals.
 */
export const channelHealthService = {
  /**
   * Fold a delivery outcome into the account's health. Runs INSIDE the delivery
   * engine's transaction so counters, score, and history never drift from the
   * delivery record. Returns the state transition so the caller can log the
   * matching activity in the same transaction.
   */
  async recordDeliveryOutcome(
    tx: Prisma.TransactionClient,
    account: ChannelAccount,
    outcome: DeliveryOutcome,
  ): Promise<HealthTransition> {
    const now = new Date();
    const previousState = account.connectionState;
    const score = clampScore(
      account.healthScore +
        (outcome.success ? SUCCESS_DELTA : -FAILURE_DELTA),
    );
    const newState = stateFromScore(score);

    const data: Prisma.ChannelAccountUncheckedUpdateInput = outcome.success
      ? {
          healthScore: score,
          connectionState: newState,
          successCount: { increment: 1 },
          consecutiveFailures: 0,
          lastSuccessfulDeliveryAt: now,
          lastHealthyAt: now,
          ...(account.status === 'ERROR' ? { status: 'CONNECTED' } : {}),
        }
      : {
          healthScore: score,
          connectionState: newState,
          failureCount: { increment: 1 },
          consecutiveFailures: { increment: 1 },
          lastFailedDeliveryAt: now,
          lastErrorCode: outcome.errorCode ?? account.lastErrorCode,
          lastErrorMessage: outcome.errorMessage ?? account.lastErrorMessage,
          ...(account.status === 'CONNECTED' && newState === 'UNAVAILABLE'
            ? { status: 'ERROR' }
            : {}),
        };

    await tx.channelAccount.update({ where: { id: account.id }, data });

    await channelsRepository.createHealthCheck(tx, {
      companyId: account.companyId,
      channelAccountId: account.id,
      checkType: 'DELIVERY',
      state: newState,
      healthy: outcome.success,
      healthScore: score,
      latencyMs: outcome.latencyMs ?? null,
      errorCode: outcome.success ? null : outcome.errorCode ?? null,
      errorMessage: outcome.success ? null : outcome.errorMessage ?? null,
      source: 'delivery',
    });

    const degraded = isDegradation(previousState, newState);
    const recovered = isRecovery(previousState, newState);
    return { previousState, newState, degraded, recovered, healthScore: score };
  },

  /**
   * Manual health-check probe (authenticated endpoint). Uses the provider's
   * connection check as the authoritative connection signal, records a MANUAL
   * history sample, and logs degradation/recovery. Does not touch delivery
   * counters — connection reachability and delivery success are distinct.
   */
  async runHealthCheck(
    companyId: string,
    channelAccountId: string,
    actorUserId: string,
  ): Promise<ChannelAccountView> {
    const account = await channelsRepository.findByIdScoped(
      companyId,
      channelAccountId,
    );
    if (!account) throw AppError.notFound('Channel account not found');

    const provider = channelRegistry.tryGet(account.providerKey);
    const now = new Date();

    let nextState: ChannelConnectionState = 'UNKNOWN';
    let errorCode: string | null = null;
    let errorMessage: string | null = null;

    if (!provider || typeof provider.checkConnection !== 'function') {
      nextState = 'UNAVAILABLE';
      errorCode = 'NOT_CONNECTABLE';
      errorMessage = 'Provider does not support health checks yet';
    } else {
      try {
        // Credentialed providers (WhatsApp) probe the real API with the decrypted
        // per-account credentials; credential-free providers pass null.
        const credentials = provider.requiresCredentials
          ? await channelCredentialsService.load(companyId, account.id)
          : null;
        const result = await provider.checkConnection({
          externalAccountId: account.externalAccountId,
          metadata:
            (account.metadata as Record<string, unknown> | null) ?? null,
          credentials,
        });
        nextState = result.state;
        errorCode = result.state === 'HEALTHY' ? null : result.errorCode ?? null;
        errorMessage =
          result.state === 'HEALTHY' ? null : result.errorMessage ?? null;
      } catch (err) {
        nextState = 'UNAVAILABLE';
        errorCode = 'HEALTH_CHECK_ERROR';
        errorMessage = 'Health check failed';
        logger.warn('channel.health.error', {
          companyId,
          channelAccountId,
          error: err instanceof Error ? err.message : 'unknown',
        });
      }
    }

    const healthy = nextState === 'HEALTHY';
    const previousState = account.connectionState;
    // Nudge the score toward the probe result without wiping delivery history.
    const score = clampScore(account.healthScore + (healthy ? 10 : -10));

    const updateData: Prisma.ChannelAccountUpdateManyMutationInput = {
      connectionState: nextState,
      healthScore: score,
      lastHealthCheckAt: now,
      lastHealthyAt: healthy ? now : account.lastHealthyAt,
      lastErrorCode: errorCode,
      lastErrorMessage: errorMessage,
      ...(account.status === 'CONNECTED' && !healthy
        ? { status: 'ERROR' as const }
        : {}),
      ...(account.status === 'ERROR' && healthy
        ? { status: 'CONNECTED' as const }
        : {}),
    };

    const updated = await prisma.$transaction(async (tx) => {
      const acc = await tx.channelAccount.update({
        where: { id: account.id },
        data: updateData,
      });
      await channelsRepository.createHealthCheck(tx, {
        companyId,
        channelAccountId: account.id,
        checkType: 'MANUAL',
        state: nextState,
        healthy,
        healthScore: score,
        errorCode,
        errorMessage,
        source: 'manual',
      });
      if (previousState !== nextState) {
        await channelsRepository.logChannelActivity(tx, {
          companyId,
          channelAccountId: account.id,
          actorUserId,
          activityType: 'CHANNEL_HEALTH_CHANGED',
          metadata: { from: previousState, to: nextState },
        });
        if (isDegradation(previousState, nextState)) {
          await channelsRepository.logChannelActivity(tx, {
            companyId,
            channelAccountId: account.id,
            actorUserId,
            activityType: 'CHANNEL_DEGRADED',
            metadata: { from: previousState, to: nextState, source: 'manual' },
          });
        } else if (isRecovery(previousState, nextState)) {
          await channelsRepository.logChannelActivity(tx, {
            companyId,
            channelAccountId: account.id,
            actorUserId,
            activityType: 'CHANNEL_RECOVERED',
            metadata: { from: previousState, to: nextState, source: 'manual' },
          });
        }
      }
      return acc;
    });

    return serializeChannelAccount(updated as ChannelAccount);
  },

  /**
   * Safe, credential-free diagnostics bundle for the monitoring dashboard:
   * current health, counters, health history, delivery metrics, retry stats,
   * recent failures, and recent recoveries.
   */
  async getDiagnostics(companyId: string, channelAccountId: string) {
    const account = await channelsRepository.findByIdScoped(
      companyId,
      channelAccountId,
    );
    if (!account) throw AppError.notFound('Channel account not found');

    const [
      history,
      deliveryCounts,
      attemptCounts,
      failedDeliveries,
      recoveries,
      retriedCount,
      totalDeliveries,
    ] = await Promise.all([
      channelsRepository.listHealthHistory(companyId, channelAccountId, 20),
      channelsRepository.deliveryStatusCounts(companyId, channelAccountId),
      channelsRepository.attemptStatusCounts(companyId, channelAccountId),
      channelsRepository.recentFailedDeliveries(companyId, channelAccountId, 10),
      channelsRepository.recentActivitiesByType(
        companyId,
        channelAccountId,
        ['DELIVERY_RECOVERED', 'CHANNEL_RECOVERED'],
        10,
      ),
      prisma.channelDelivery.count({
        where: { companyId, channelAccountId, attemptCount: { gt: 1 } },
      }),
      prisma.channelDelivery.count({ where: { companyId, channelAccountId } }),
    ]);

    const deliveryMetrics: Record<string, number> = {};
    for (const row of deliveryCounts) {
      deliveryMetrics[row.status] = row._count._all;
    }
    const attemptMetrics: Record<string, number> = {};
    let totalAttempts = 0;
    for (const row of attemptCounts) {
      attemptMetrics[row.status] = row._count._all;
      totalAttempts += row._count._all;
    }

    return {
      account: serializeChannelAccount(account),
      health: {
        connectionState: account.connectionState,
        healthScore: account.healthScore,
        successCount: account.successCount,
        failureCount: account.failureCount,
        consecutiveFailures: account.consecutiveFailures,
        lastSuccessfulDeliveryAt: account.lastSuccessfulDeliveryAt,
        lastFailedDeliveryAt: account.lastFailedDeliveryAt,
        lastHealthCheckAt: account.lastHealthCheckAt,
      },
      healthHistory: history.map((h) => ({
        id: h.id,
        checkType: h.checkType,
        state: h.state,
        healthy: h.healthy,
        healthScore: h.healthScore,
        latencyMs: h.latencyMs,
        errorCode: h.errorCode,
        source: h.source,
        createdAt: h.createdAt,
      })),
      deliveryMetrics: {
        total: totalDeliveries,
        byStatus: deliveryMetrics,
      },
      retryStats: {
        totalAttempts,
        byOutcome: attemptMetrics,
        retriedDeliveries: retriedCount,
      },
      recentFailures: failedDeliveries.map((d) => ({
        id: d.id,
        messageId: d.messageId,
        status: d.status,
        failureType: d.failureType,
        failureCode: d.failureCode,
        attemptCount: d.attemptCount,
        maxAttempts: d.maxAttempts,
        nextAttemptAt: d.nextAttemptAt,
        updatedAt: d.updatedAt,
      })),
      recentRecoveries: recoveries.map((a) => ({
        id: a.id,
        activityType: a.activityType,
        metadata: a.metadata,
        createdAt: a.createdAt,
      })),
    };
  },
};
