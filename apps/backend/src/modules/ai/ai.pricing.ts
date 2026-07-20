/**
 * Centralized, single-source model pricing. Cost is ALWAYS an ESTIMATE — it is
 * not the provider invoice. Prices are USD per 1,000,000 tokens and are versioned
 * so the snapshot used at generation time can be recorded.
 *
 * Update these values from the provider's public pricing page as needed.
 */
export const PRICING_VERSION = '2025-06';

interface ModelPrice {
  inputPer1M: number;
  outputPer1M: number;
}

const MODEL_PRICES: Record<string, ModelPrice> = {
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6 },
  'gpt-4.1': { inputPer1M: 2, outputPer1M: 8 },
  'gpt-4.1-nano': { inputPer1M: 0.1, outputPer1M: 0.4 },
};

/**
 * Resolve a price entry for a model, tolerating dated snapshot names. The
 * Responses API returns e.g. `gpt-4o-mini-2024-07-18` while the table is keyed
 * by the base `gpt-4o-mini`; we strip the trailing date, then fall back to the
 * longest known-key prefix match.
 */
function resolvePrice(model: string): ModelPrice | undefined {
  if (MODEL_PRICES[model]) return MODEL_PRICES[model];
  const undated = model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  if (MODEL_PRICES[undated]) return MODEL_PRICES[undated];
  const prefixKey = Object.keys(MODEL_PRICES)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return prefixKey ? MODEL_PRICES[prefixKey] : undefined;
}

/**
 * Estimated USD cost for a generation. Returns null when the model price is
 * unknown (so callers can store null rather than a fabricated number).
 */
export function estimateCostUsd(
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  const price = resolvePrice(model);
  if (!price || inputTokens === null || outputTokens === null) return null;
  const cost =
    (inputTokens / 1_000_000) * price.inputPer1M +
    (outputTokens / 1_000_000) * price.outputPer1M;
  // Round to 6 decimal places to match the Decimal(_, 6) column.
  return Math.round(cost * 1_000_000) / 1_000_000;
}
