/**
 * Provider-agnostic AI abstraction. A new provider (Anthropic, local, etc.)
 * only needs to implement {@link AIProvider}; nothing else in the app changes.
 */

/** A single conversation turn passed to the provider (never system rules). */
export interface AIProviderMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIProviderInput {
  /** System instructions (platform safety + company config + context). */
  systemPrompt: string;
  /** Ordered conversation turns; the final `user` turn is the current question. */
  messages: AIProviderMessage[];
  model: string;
  maxOutputTokens: number;
  temperature: number;
  timeoutMs: number;
  maxRetries: number;
}

export interface AIProviderResult {
  text: string;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  providerResponseId: string | null;
  finishReason: string | null;
  latencyMs: number;
}

export interface AIProvider {
  readonly name: string;
  generateResponse(input: AIProviderInput): Promise<AIProviderResult>;
}
