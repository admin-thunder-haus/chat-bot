import type { AIProvider } from './providers/ai-provider.interface';
import { OpenAIProvider } from './providers/openai.provider';
import { AIError } from './ai.errors';
import { env } from '../../config/env';

// Test override: automated tests inject a fake provider so the real OpenAI API
// is never called. Set to null to restore normal resolution.
let testOverride: AIProvider | null = null;
export function setAIProviderForTesting(provider: AIProvider | null): void {
  testOverride = provider;
}

let singleton: AIProvider | null = null;

/**
 * Resolve the active AI provider. Throws typed AIErrors when the feature is
 * disabled or unconfigured so callers return safe responses.
 */
export function getAIProvider(): AIProvider {
  if (testOverride) return testOverride;
  if (!env.AI_FEATURE_ENABLED) throw AIError.disabled();
  if (!env.OPENAI_API_KEY) throw AIError.notConfigured();
  if (!singleton) {
    singleton = new OpenAIProvider({
      apiKey: env.OPENAI_API_KEY,
      timeoutMs: env.OPENAI_TIMEOUT_MS,
      maxRetries: env.OPENAI_MAX_RETRIES,
    });
  }
  return singleton;
}
