import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { OutboundWebhook } from '@prisma/client';
import { isTest } from '../../config/env';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import { channelSecurityService } from '../channels/channel-security.service';
import { publicApiRepository } from './public-api.repository';
import {
  serializeDelivery,
  serializeWebhook,
  type SerializedDelivery,
  type SerializedWebhook,
} from './public-api.types';
import type {
  CreateWebhookInput,
  UpdateWebhookInput,
} from './public-api.validation';

/**
 * Customer-configured outbound webhooks: CRUD + the dispatcher that signs and
 * delivers domain events. The signing secret is stored AES-256-GCM encrypted
 * (channel-credential pattern), decrypted only at send time, and returned to
 * the customer exactly once at creation.
 */

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = isTest ? 25 : 1000;
const REQUEST_TIMEOUT_MS = 10_000;
/** Consecutive failed deliveries before the endpoint is auto-disabled. */
const AUTO_DISABLE_AFTER_FAILURES = 20;
const DELIVERIES_PAGE_SIZE = 20;

export interface OutboundWebhookRequest {
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

export type OutboundWebhookTransport = (
  url: string,
  request: OutboundWebhookRequest,
) => Promise<{ status: number }>;

/** Default transport: plain POST with a hard timeout. */
const defaultTransport: OutboundWebhookTransport = async (url, request) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(request.timeoutMs),
    redirect: 'error',
  });
  return { status: response.status };
};

let transportOverride: OutboundWebhookTransport | null = null;

/** Test seam: replace the HTTP transport (pass null to restore). */
export function setOutboundWebhookTransportForTesting(
  transport: OutboundWebhookTransport | null,
): void {
  transportOverride = transport;
}

function getTransport(): OutboundWebhookTransport {
  return transportOverride ?? defaultTransport;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateSigningSecret(): string {
  return `whsec_${randomBytes(24).toString('hex')}`;
}

/** HMAC-SHA256 signature over the raw request body. */
export function signWebhookPayload(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export const outboundWebhooksService = {
  // --- Management (dashboard) ---

  /** Create an endpoint. The signing secret is returned ONCE, never again. */
  async create(
    companyId: string,
    input: CreateWebhookInput,
  ): Promise<{ webhook: SerializedWebhook; secret: string }> {
    const secret = generateSigningSecret();
    const { encryptedPayload } = channelSecurityService.encrypt({ secret });
    const created = await publicApiRepository.createWebhook(companyId, {
      url: input.url,
      encryptedSecret: encryptedPayload,
      events: input.events,
      isActive: true,
    });
    return { webhook: serializeWebhook(created), secret };
  },

  async list(companyId: string): Promise<SerializedWebhook[]> {
    const webhooks = await publicApiRepository.listWebhooks(companyId);
    return webhooks.map(serializeWebhook);
  },

  async update(
    companyId: string,
    id: string,
    input: UpdateWebhookInput,
  ): Promise<SerializedWebhook> {
    const data: Record<string, unknown> = {};
    if (input.url !== undefined) data.url = input.url;
    if (input.events !== undefined) data.events = input.events;
    if (input.isActive !== undefined) {
      data.isActive = input.isActive;
      // Re-enabling clears the consecutive-failure streak so the endpoint is
      // not immediately re-disabled by a stale counter.
      if (input.isActive) data.failureCount = 0;
    }
    const updated = await publicApiRepository.updateWebhook(
      companyId,
      id,
      data,
    );
    if (!updated) throw AppError.notFound('Webhook not found');
    return serializeWebhook(updated);
  },

  async remove(companyId: string, id: string): Promise<void> {
    const count = await publicApiRepository.removeWebhook(companyId, id);
    if (count === 0) throw AppError.notFound('Webhook not found');
  },

  async listDeliveries(
    companyId: string,
    webhookId: string,
  ): Promise<SerializedDelivery[]> {
    const webhook = await publicApiRepository.findWebhookScoped(
      companyId,
      webhookId,
    );
    if (!webhook) throw AppError.notFound('Webhook not found');
    const deliveries = await publicApiRepository.listDeliveries(
      companyId,
      webhookId,
      DELIVERIES_PAGE_SIZE,
    );
    return deliveries.map(serializeDelivery);
  },

  // --- Dispatcher (domain-event consumer) ---

  /**
   * Deliver an event to every active, subscribed endpoint of the company.
   * Never throws: per-endpoint outcomes are recorded on the delivery log and
   * the webhook row itself.
   */
  async dispatchEvent(
    companyId: string,
    eventType: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const webhooks = await publicApiRepository.findActiveSubscribed(
      companyId,
      eventType,
    );
    if (webhooks.length === 0) return;

    const body = JSON.stringify({
      id: randomUUID(),
      type: eventType,
      createdAt: new Date().toISOString(),
      data,
    });

    await Promise.all(
      webhooks.map((webhook) => this.deliver(webhook, eventType, body)),
    );
  },

  /** Deliver one payload to one endpoint: sign, retry, log — never throws. */
  async deliver(
    webhook: OutboundWebhook,
    eventType: string,
    body: string,
  ): Promise<void> {
    let secret: string;
    try {
      const decrypted = channelSecurityService.decrypt(webhook.encryptedSecret);
      secret = String(decrypted.secret ?? '');
      if (!secret) throw new Error('empty signing secret');
    } catch {
      // Undeliverable without a secret — log the failure, no retries.
      await this.recordOutcome(webhook, eventType, {
        delivered: false,
        attemptCount: 0,
        responseStatus: null,
        errorMessage: 'Signing secret is unavailable',
      });
      return;
    }

    const headers = {
      'Content-Type': 'application/json',
      'X-Webhook-Event': eventType,
      'X-Webhook-Signature': signWebhookPayload(secret, body),
    };

    let responseStatus: number | null = null;
    let errorMessage = 'Delivery failed';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const result = await getTransport()(webhook.url, {
          body,
          headers,
          timeoutMs: REQUEST_TIMEOUT_MS,
        });
        responseStatus = result.status;
        if (result.status >= 200 && result.status < 300) {
          await this.recordOutcome(webhook, eventType, {
            delivered: true,
            attemptCount: attempt,
            responseStatus: result.status,
            errorMessage: null,
          });
          return;
        }
        errorMessage = `Endpoint responded with HTTP ${result.status}`;
      } catch (err) {
        responseStatus = null;
        errorMessage = err instanceof Error ? err.message : String(err);
      }
      if (attempt < MAX_ATTEMPTS) await delay(RETRY_DELAY_MS);
    }

    await this.recordOutcome(webhook, eventType, {
      delivered: false,
      attemptCount: MAX_ATTEMPTS,
      responseStatus,
      errorMessage,
    });
  },

  /** Persist a delivery-log row + success/failure counters. Never throws. */
  async recordOutcome(
    webhook: OutboundWebhook,
    eventType: string,
    outcome: {
      delivered: boolean;
      attemptCount: number;
      responseStatus: number | null;
      errorMessage: string | null;
    },
  ): Promise<void> {
    try {
      await publicApiRepository.createDelivery(webhook.companyId, {
        webhookId: webhook.id,
        eventType,
        status: outcome.delivered ? 'delivered' : 'failed',
        attemptCount: outcome.attemptCount,
        responseStatus: outcome.responseStatus,
        errorMessage: outcome.errorMessage,
      });
      if (outcome.delivered) {
        await publicApiRepository.recordWebhookSuccess(webhook.id);
      } else {
        await publicApiRepository.recordWebhookFailure(
          webhook.id,
          AUTO_DISABLE_AFTER_FAILURES,
        );
      }
    } catch (err) {
      logger.warn('outboundWebhooks.recordOutcome.failed', {
        webhookId: webhook.id,
        eventType,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },
};
