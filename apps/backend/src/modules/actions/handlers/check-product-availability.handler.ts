import { z } from 'zod';
import type {
  ActionContext,
  ActionHandler,
  ActionResult,
} from '../action-registry';
import { actionsRepository } from '../actions.repository';

const inputSchema = z.object({
  productName: z
    .string({ required_error: 'the product name to look up' })
    .trim()
    .min(1)
    .max(160),
});

type Input = z.infer<typeof inputSchema>;

/**
 * READ-ONLY availability lookup. "Product not found" is a normal result here
 * (never a thrown error) — the summary is fed back to the model so the
 * customer receives a natural-language answer either way.
 */
export const checkProductAvailabilityHandler: ActionHandler = {
  key: 'check_product_availability',
  description:
    'Check whether a catalog product is currently in stock (and its price) when the customer asks about availability.',
  inputSchema,
  inputExample: { productName: 'Coffee Beans' },
  readOnly: true,

  async execute(
    ctx: ActionContext,
    rawInput: Record<string, unknown>,
  ): Promise<ActionResult> {
    const input = rawInput as Input;

    const product = await actionsRepository.findProductByName(
      ctx.companyId,
      input.productName,
    );
    if (!product) {
      return {
        summary: `Product not found: no active product matches "${input.productName}".`,
        data: { found: false, query: input.productName },
      };
    }

    const stockLabel =
      product.stockQuantity === null
        ? 'Stock not tracked'
        : product.stockQuantity > 0
          ? `In stock: ${product.stockQuantity}`
          : 'Out of stock';
    const priceLabel = product.price
      ? ` Price: ${product.price.toFixed(2)} ${product.currency}.`
      : '';

    return {
      summary: `${product.name} — ${stockLabel}.${priceLabel}`,
      data: {
        found: true,
        productId: product.id,
        name: product.name,
        stockQuantity: product.stockQuantity,
        price: product.price?.toFixed(2) ?? null,
        currency: product.currency,
      },
    };
  },
};
