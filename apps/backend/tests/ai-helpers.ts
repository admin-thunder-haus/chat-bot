import type {
  AIProvider,
  AIProviderInput,
  AIProviderResult,
} from '../src/modules/ai/providers/ai-provider.interface';
import { AIError } from '../src/modules/ai/ai.errors';

export interface FakeProviderHandle {
  provider: AIProvider;
  calls: AIProviderInput[];
  lastInput(): AIProviderInput | undefined;
}

/**
 * Deterministic in-memory provider for tests — the real OpenAI API is never
 * called. Records every input so prompt construction can be asserted.
 */
export function makeFakeProvider(
  options: {
    text?: string;
    throwError?: AIError;
    inputTokens?: number;
    outputTokens?: number;
  } = {},
): FakeProviderHandle {
  const calls: AIProviderInput[] = [];
  const provider: AIProvider = {
    name: 'fake',
    async generateResponse(input: AIProviderInput): Promise<AIProviderResult> {
      calls.push(input);
      if (options.throwError) throw options.throwError;
      const inputTokens = options.inputTokens ?? 12;
      const outputTokens = options.outputTokens ?? 8;
      return {
        text: options.text ?? 'This is a helpful AI response.',
        provider: 'fake',
        model: input.model,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        providerResponseId: 'resp_fake_1',
        finishReason: 'completed',
        latencyMs: 3,
      };
    },
  };
  return { provider, calls, lastInput: () => calls[calls.length - 1] };
}
