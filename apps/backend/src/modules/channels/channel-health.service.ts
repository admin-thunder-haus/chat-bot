import type {
  ChannelAccount,
  ChannelConnectionState,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import { emitDomainEvent } from '../events/domain-events.service';
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

/**
 * States that mean the channel is DOWN for the customer and only the owner can
 * fix it. DEGRADED is deliberately excluded: it is noisy, self-healing, and
 * already visible on the channels page — waking someone at 3am for it would
 * teach them to ignore the alert that matters.
 */
const ALERT_STATES: ChannelConnectionState[] = ['UNAVAILABLE', 'AUTH_EXPIRED'];

/**
 * True only on the EDGE into a down state. A channel that stays broken keeps
 * failing every health check and every delivery, so alerting on the state
 * itself would notify the owner every minute; alerting on the transition
 * notifies once, and again only after a genuine recovery.
 */
function entersAlertState(
  prev: ChannelConnectionState,
  next: ChannelConnectionState,
): boolean {
  return ALERT_STATES.includes(next) && !ALERT_STATES.includes(prev);
}

/**
 * Owner-facing alert for a channel that just went down. Shared by both places
 * that compute a state transition (manual probe + delivery outcome) so the
 * wording and the edge condition can never drift apart.
 *
 * The copy names the channel and says what to do next; the raw connection-state
 * enum stays out of the text and lives in `data` for integrators.
 */
async function emitChannelUnavailableAlert(
  account: ChannelAccount,
  newState: ChannelConnectionState,
  previousState: ChannelConnectionState,
  source: 'manual' | 'delivery',
): Promise<void> {
  const authExpired = newState === 'AUTH_EXPIRED';
  const title = authExpired
    ? `${account.displayName} sign-in has expired`
    : `${account.displayName} is not responding`;
  const body = authExpired
    ? `The sign-in for ${account.displayName} has expired, so messages can no longer be sent or received on it. Open Setup → Channels and reconnect the channel to start serving customers again.`
    : `${account.displayName} stopped responding, so messages are not reaching your customers right now. Open Setup → Channels, run a health check, and reconnect the channel if it stays down.`;

  await emitDomainEvent({
    companyId: account.companyId,
    type: 'channel.unavailable',
    title,
    body,
    data: {
      channelAccountId: account.id,
      providerKey: account.providerKey,
      channelType: account.channelType,
      connectionState: newState,
      previousState,
      detectedBy: source,
    },
    notify: { type: 'SYSTEM_ALERT', emailRoles: ['OWNER'] },
  });
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
/**
 * A health-check result: the account as usual, plus whether the provider can
 * actually reach US. The two are deliberately separate — outbound and inbound
 * fail independently, and a channel that sends but cannot receive was
 * previously indistinguishable from a fully working one.
 */
export interface ChannelHealthCheckView extends ChannelAccountView {
  inbound: { ready: boolean | null; detail: string | null };
}

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

    if (entersAlertState(previousState, newState)) {
      // DETACHED on purpose. This method runs INSIDE the delivery engine's
      // transaction, and emitDomainEvent does I/O (owner email + the customer's
      // own webhooks, with retries). Awaiting it here would hold the
      // transaction open past Prisma's timeout and roll the delivery back — the
      // alert must never cost us the message. emitDomainEvent never rejects, so
      // nothing escapes this call.
      void emitChannelUnavailableAlert(
        account,
        newState,
        previousState,
        'delivery',
      );
    }

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
  ): Promise<ChannelHealthCheckView> {
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

    // INBOUND readiness, reported separately from connectionState on purpose.
    // Folding it in would mean a legacy channel connected with the customer's
    // own Meta app (where our app id is legitimately absent) starts alarming.
    // The operator needs to see "sends fine, cannot receive" as its own fact.
    let inbound: { ready: boolean | null; detail?: string } = { ready: null };
    if (provider && typeof provider.checkInboundReadiness === 'function') {
      try {
        const credentials = provider.requiresCredentials
          ? await channelCredentialsService.load(companyId, account.id)
          : null;
        inbound = await provider.checkInboundReadiness({
          externalAccountId: account.externalAccountId,
          externalPageId: account.externalPageId,
          credentials,
        });
      } catch {
        inbound = { ready: null, detail: 'UNKNOWN' };
      }
      if (inbound.ready === false) {
        logger.warn('channel.inbound.notReady', {
          companyId,
          channelAccountId,
          providerKey: account.providerKey,
          detail: inbound.detail,
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

    // AFTER the transaction commits: the alert is only true once the new state
    // is durable, and emitDomainEvent's I/O must not run inside a transaction.
    if (entersAlertState(previousState, nextState)) {
      await emitChannelUnavailableAlert(
        account,
        nextState,
        previousState,
        'manual',
      );
    }

    return {
      ...serializeChannelAccount(updated as ChannelAccount),
      // Reported alongside connectionState, never merged into it. `null` means
      // "could not determine", which is different from "not ready".
      inbound: { ready: inbound.ready, detail: inbound.detail ?? null },
    };
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
