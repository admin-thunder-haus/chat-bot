import type { z } from 'zod';

/**
 * AI Actions framework — the registry.
 *
 * An ActionHandler is a self-contained, plug-in unit of "something the AI can
 * DO for a customer" (book an appointment, create an order, …). The AI layer
 * never knows about concrete actions: it advertises the registered handlers in
 * the system prompt and forwards the model's ACTION_REQUEST to the actions
 * service, which validates against the handler's schema and executes it.
 * Adding a new capability = one new handler file + registration below.
 */

/** Tenant-scoped execution context. Everything a handler may write is scoped by companyId. */
export interface ActionContext {
  companyId: string;
  conversationId?: string;
  customerId?: string;
}

/** What a handler returns: a customer-friendly summary + safe structured data. */
export interface ActionResult {
  summary: string;
  data?: Record<string, unknown>;
}

export interface ActionHandler {
  /** Stable machine key the model uses in ACTION_REQUEST (snake_case). */
  key: string;
  /** One line shown to the model — what this action does and when to use it. */
  description: string;
  /** Strict input contract. The actions service validates BEFORE execute runs. */
  inputSchema: z.ZodObject<z.ZodRawShape>;
  /** Compact example object embedded in the system prompt. */
  inputExample: Record<string, unknown>;
  /**
   * Read-only actions (lookups) produce no business record and no team
   * notification; their summary is fed back to the model for a natural reply.
   */
  readOnly?: boolean;
  /**
   * Execute with an input ALREADY validated by `inputSchema`. Throwing an
   * Error marks the execution 'failed' and its message (customer-safe!) is
   * relayed as "Sorry, I couldn't complete that: <message>".
   */
  execute(
    ctx: ActionContext,
    input: Record<string, unknown>,
  ): Promise<ActionResult>;
}

/**
 * Central action registry (channel-registry pattern). Handlers are registered
 * exactly once at startup; tests may replace them via registerOrReplace.
 */
class ActionRegistry {
  private readonly handlers = new Map<string, ActionHandler>();

  register(handler: ActionHandler): void {
    if (this.handlers.has(handler.key)) {
      throw new Error(`Action handler "${handler.key}" is already registered`);
    }
    this.handlers.set(handler.key, handler);
  }

  /** Register (or replace) a handler — for tests/DI only. */
  registerOrReplace(handler: ActionHandler): void {
    this.handlers.set(handler.key, handler);
  }

  has(key: string): boolean {
    return this.handlers.has(key);
  }

  /** Resolve a handler by key; returns null when unknown (no throw). */
  get(key: string): ActionHandler | null {
    return this.handlers.get(key) ?? null;
  }

  /** All registered handlers, in registration order. */
  list(): ActionHandler[] {
    return [...this.handlers.values()];
  }
}

export const actionRegistry = new ActionRegistry();

// Handler imports live below the registry definition; handlers only use
// `import type` from this module, so there is no runtime cycle.
import { bookAppointmentHandler } from './handlers/book-appointment.handler';
import { createOrderHandler } from './handlers/create-order.handler';
import { createSupportTicketHandler } from './handlers/create-support-ticket.handler';
import { checkProductAvailabilityHandler } from './handlers/check-product-availability.handler';

/**
 * Register the built-in actions. Called once at module load (channel-provider
 * pattern); idempotent so repeated imports in tests never throw.
 */
export function registerBuiltInActions(): void {
  const builtIns: ActionHandler[] = [
    bookAppointmentHandler,
    createOrderHandler,
    createSupportTicketHandler,
    checkProductAvailabilityHandler,
  ];
  for (const handler of builtIns) {
    if (!actionRegistry.has(handler.key)) {
      actionRegistry.register(handler);
    }
  }
}

registerBuiltInActions();
