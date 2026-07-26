import type { LoginAuditEvent, LoginAuditOutcome } from '@prisma/client';
import { loginAuditRepository } from './login-audit.repository';
import { env, isLoginAuditPruneEnabled } from '../../config/env';
import { logger } from '../../utils/logger';

/**
 * The login audit trail: one row per sign-in attempt, successful or not.
 *
 * It is a cheap trust signal ("here is every sign-in on your account") and the
 * ONLY record that survives a failure — nothing else remembers that someone
 * tried a wrong password. It is deliberately NOT a security control: it never
 * blocks, rate-limits or changes an HTTP response.
 */

/**
 * A user agent is a client-controlled header with no practical length limit.
 * Truncated before insert so a hostile client cannot turn each login attempt
 * into a multi-megabyte write.
 */
const USER_AGENT_MAX_LENGTH = 512;

/** Rows returned by the history endpoint. Bounded — never an unbounded list. */
const HISTORY_LIMIT = 20;

/**
 * Chance that a recorded attempt also prunes the trail (1 in 100).
 *
 * Chosen over a second `setInterval`: logins are the ONLY thing that grows this
 * table, so pinning the prune rate to the write rate makes it self-scaling —
 * a busy tenant prunes often, an idle instance never wakes up to delete
 * nothing, and the process needs no extra timer to keep alive or shut down.
 * The prune is fire-and-forget and bounded by an in-flight guard, so at most one
 * DELETE is in progress per process no matter how many logins land at once.
 */
const PRUNE_PROBABILITY = 0.01;

/** Guard: one prune at a time, so a login burst cannot stack DELETEs. */
let pruneInFlight = false;

/** What the controller knows and the service does not: who the client is. */
export interface LoginAuditContext {
  /** `req.ip` — already the real client IP ('trust proxy' is set in app.ts). */
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** One entry of the caller's own sign-in history, as sent to the client. */
export interface LoginHistoryEntry {
  id: string;
  outcome: LoginAuditOutcome;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface LoginAuditPruneResult {
  deleted: number;
  /** Set when the prune failed (the error was logged and swallowed). */
  error?: string;
}

/**
 * The attempted email never reaches the client, and the row is keyed on the
 * user, so the entry carries no field a caller could use to learn about anyone
 * else's account.
 */
function toHistoryEntry(event: LoginAuditEvent): LoginHistoryEntry {
  return {
    id: event.id,
    outcome: event.outcome,
    ipAddress: event.ipAddress,
    userAgent: event.userAgent,
    createdAt: event.createdAt,
  };
}

/**
 * Delete every attempt older than the retention window.
 *
 * Never rejects: it runs from a fire-and-forget call on the login path, and an
 * unhandled rejection there would take the process down. Exported so tests (and
 * any future cron/admin trigger) can drive a prune deterministically, with no
 * timer and no sleeping.
 */
export async function pruneLoginAuditEvents(): Promise<LoginAuditPruneResult> {
  const cutoff = new Date(
    Date.now() - env.LOGIN_AUDIT_RETENTION_DAYS * 86_400_000,
  );

  try {
    const deleted = await loginAuditRepository.deleteOlderThan(cutoff);
    if (deleted > 0) {
      logger.info('auth.loginAudit.pruned', {
        deleted,
        retentionDays: env.LOGIN_AUDIT_RETENTION_DAYS,
      });
    }
    return { deleted };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('auth.loginAudit.prune.failed', { message });
    return { deleted: 0, error: message };
  }
}

/**
 * Maybe prune, riding along on a write we already made. Returns whether a prune
 * was started, so this stays testable without waiting on chance.
 */
function maybePrune(): boolean {
  if (!isLoginAuditPruneEnabled()) return false;
  if (pruneInFlight) return false;
  if (Math.random() >= PRUNE_PROBABILITY) return false;

  pruneInFlight = true;
  // Deliberately not awaited: the caller is mid-login and must not pay for
  // housekeeping. pruneLoginAuditEvents never rejects, so nothing escapes here.
  void pruneLoginAuditEvents().finally(() => {
    pruneInFlight = false;
  });
  return true;
}

export const loginAuditService = {
  /**
   * Record one login attempt. NEVER throws — recording is observability, and a
   * failed insert must not turn a valid sign-in into a 500 (same contract as
   * billingService.ensureTrialSubscription: try, log, swallow).
   */
  async record(input: {
    outcome: LoginAuditOutcome;
    /** Always set: for an unknown email it is the only identifier we have. */
    email: string;
    companyId?: string | null;
    userId?: string | null;
    context?: LoginAuditContext;
  }): Promise<void> {
    try {
      await loginAuditRepository.create({
        // The login schema already lowercases; normalized again so a caller
        // that bypasses validation cannot hide a case-variant probe.
        email: input.email.toLowerCase(),
        outcome: input.outcome,
        companyId: input.companyId ?? null,
        userId: input.userId ?? null,
        ipAddress: input.context?.ipAddress ?? null,
        userAgent:
          input.context?.userAgent?.slice(0, USER_AGENT_MAX_LENGTH) ?? null,
      });
      maybePrune();
    } catch (err) {
      logger.warn('auth.loginAudit.record.failed', {
        outcome: input.outcome,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },

  /**
   * The caller's OWN recent attempts. Both ids come from the verified access
   * token, never from the request, so there is no parameter to tamper with and
   * no way to ask for someone else's trail.
   */
  async listForUser(
    companyId: string,
    userId: string,
  ): Promise<{ events: LoginHistoryEntry[]; limit: number }> {
    const events = await loginAuditRepository.findRecentForUser({
      companyId,
      userId,
      limit: HISTORY_LIMIT,
    });
    return { events: events.map(toHistoryEntry), limit: HISTORY_LIMIT };
  },
};
