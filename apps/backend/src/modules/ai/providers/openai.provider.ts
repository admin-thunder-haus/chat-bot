import OpenAI from 'openai';
import type {
  AIProvider,
  AIProviderInput,
  AIProviderResult,
} from './ai-provider.interface';
import { AIError } from '../ai.errors';

/**
 * OpenAI provider using the Responses API. System rules are passed via
 * `instructions` (trusted) and conversation turns via `input` (untrusted user
 * content) — they are never concatenated, which is a core injection defense.
 *
 * The SDK's built-in retry handles transient failures (429/5xx/timeouts) and
 * never retries auth errors, matching our reliability policy.
 */
export class OpenAIProvider implements AIProvider {
  public readonly name = 'openai';
  private readonly client: OpenAI;

  constructor(config: {
    apiKey: string;
    timeoutMs: number;
    maxRetries: number;
  }) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      timeout: config.timeoutMs,
      maxRetries: config.maxRetries,
    });
  }

  async generateResponse(input: AIProviderInput): Promise<AIProviderResult> {
    const start = Date.now();
    try {
      const response = await this.client.responses.create({
        model: input.model,
        instructions: input.systemPrompt,
        input: input.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        max_output_tokens: input.maxOutputTokens,
        temperature: input.temperature,
      });

      const text = (response.output_text ?? '').trim();
      if (!text) throw AIError.invalidResponse();

      const usage = response.usage;
      return {
        text,
        provider: this.name,
        model: response.model ?? input.model,
        inputTokens: usage?.input_tokens ?? null,
        outputTokens: usage?.output_tokens ?? null,
        totalTokens: usage?.total_tokens ?? null,
        providerResponseId: response.id ?? null,
        finishReason: response.status ?? null,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      throw mapOpenAIError(err);
    }
  }
}

/** Map SDK errors to safe AIErrors without leaking keys or internals. */
function mapOpenAIError(err: unknown): AIError {
  if (err instanceof AIError) return err;

  if (err instanceof OpenAI.APIError) {
    const status = err.status;
    if (err instanceof OpenAI.APIConnectionTimeoutError) return AIError.timeout();
    if (err instanceof OpenAI.AuthenticationError || status === 401 || status === 403) {
      return AIError.authFailed();
    }
    if (err instanceof OpenAI.RateLimitError || status === 429) {
      return AIError.rateLimited();
    }
    if (err instanceof OpenAI.APIConnectionError) return AIError.unavailable();
    if (typeof status === 'number' && status >= 500) return AIError.unavailable();
    return AIError.invalidResponse();
  }

  // Unknown error — treat as provider unavailable (never surface details).
  return AIError.unavailable();
}
