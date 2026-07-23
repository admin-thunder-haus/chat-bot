import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type {
  ActionContext,
  ActionHandler,
  ActionResult,
} from '../action-registry';
import { actionsRepository } from '../actions.repository';

const inputSchema = z.object({
  items: z
    .array(
      z.object({
        productName: z.string().trim().min(1).max(160),
        quantity: z.number().int().min(1).max(999),
      }),
    )
    .min(1, 'at least one product to order')
    .max(10, 'at most 10 different products per order'),
  notes: z.string().trim().max(1000).optional(),
});

type Input = z.infer<typeof inputSchema>;

/**
 * Creates a NEW order from the customer's requested product names. Every name
 * must resolve against the ACTIVE catalog — unknown products fail the whole
 * action with a message listing what wasn't found (no partial orders).
 */
export const createOrderHandler: ActionHandler = {
  key: 'create_order',
  description:
    'Create an order for one or more catalog products the customer wants to buy (product names + quantities).',
  inputSchema,
  inputExample: {
    items: [{ productName: 'Coffee Beans', quantity: 2 }],
    notes: 'Deliver in the morning',
  },

  async execute(
    ctx: ActionContext,
    rawInput: Record<string, unknown>,
  ): Promise<ActionResult> {
    const input = rawInput as Input;

    const resolved: {
      productId: string;
      name: string;
      quantity: number;
      unitPrice: Prisma.Decimal | null;
      currency: string;
    }[] = [];
    const notFound: string[] = [];

    for (const item of input.items) {
      const product = await actionsRepository.findProductByName(
        ctx.companyId,
        item.productName,
      );
      if (!product) {
        notFound.push(item.productName);
        continue;
      }
      resolved.push({
        productId: product.id,
        name: product.name,
        quantity: item.quantity,
        unitPrice: product.price,
        currency: product.currency,
      });
    }

    if (notFound.length > 0) {
      throw new Error(
        `these products were not found in the catalog: ${notFound.join(', ')}. Please check the product names and try again.`,
      );
    }

    // Total from known prices (Decimal math — no float drift). Products without
    // a published price are ordered anyway; the total then stays unset.
    let total = new Prisma.Decimal(0);
    let hasPricedItem = false;
    for (const item of resolved) {
      if (item.unitPrice !== null) {
        total = total.add(item.unitPrice.mul(item.quantity));
        hasPricedItem = true;
      }
    }
    const currency = resolved[0]?.currency ?? 'JOD';

    const order = await actionsRepository.createOrder(
      ctx.companyId,
      {
        customerId: ctx.customerId ?? null,
        conversationId: ctx.conversationId ?? null,
        status: 'NEW',
        totalAmount: hasPricedItem ? total : null,
        currency,
        notes: input.notes ?? null,
        createdVia: 'ai',
      },
      resolved.map((item) => ({
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        currency: item.currency,
      })),
    );

    const itemsLabel = resolved
      .map((item) => `${item.quantity}× ${item.name}`)
      .join(', ');
    const totalLabel = hasPricedItem
      ? ` — total ${total.toFixed(2)} ${currency}`
      : '';

    return {
      summary: `Order created: ${itemsLabel}${totalLabel}. Our team will confirm it shortly.`,
      data: {
        orderId: order.id,
        status: order.status,
        totalAmount: hasPricedItem ? total.toFixed(2) : null,
        currency,
        items: resolved.map((item) => ({
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice?.toFixed(2) ?? null,
        })),
      },
    };
  },
};
