import { AppError } from '../../utils/AppError';

/**
 * Application-level AI errors. Each maps to a safe HTTP response — provider
 * internals, keys, and stack traces are never exposed. The `code` is stable for
 * logging and for the frontend to branch on.
 */
export type AICode =
  | 'AI_DISABLED'
  | 'AI_NOT_CONFIGURED'
  | 'AI_TIMEOUT'
  | 'AI_RATE_LIMITED'
  | 'AI_AUTH_FAILED'
  | 'AI_INVALID_RESPONSE'
  | 'AI_UNAVAILABLE'
  | 'AI_QUOTA_EXCEEDED';

export class AIError extends AppError {
  public readonly code: AICode;

  constructor(code: AICode, message: string, statusCode: number) {
    super(message, statusCode, [{ field: 'ai', message }]);
    this.name = 'AIError';
    this.code = code;
  }

  static disabled(): AIError {
    return new AIError(
      'AI_DISABLED',
      'AI features are currently disabled',
      503,
    );
  }
  static notConfigured(): AIError {
    return new AIError(
      'AI_NOT_CONFIGURED',
      'The AI provider is not configured',
      503,
    );
  }
  static timeout(): AIError {
    return new AIError('AI_TIMEOUT', 'The AI provider timed out', 504);
  }
  static rateLimited(): AIError {
    return new AIError(
      'AI_RATE_LIMITED',
      'The AI provider is rate limited, please try again shortly',
      429,
    );
  }
  static authFailed(): AIError {
    // Auth/config problem — surfaced generically so no key details leak.
    return new AIError(
      'AI_AUTH_FAILED',
      'The AI provider is unavailable',
      502,
    );
  }
  static invalidResponse(): AIError {
    return new AIError(
      'AI_INVALID_RESPONSE',
      'The AI provider returned an invalid response',
      502,
    );
  }
  static unavailable(): AIError {
    return new AIError(
      'AI_UNAVAILABLE',
      'The AI provider is temporarily unavailable',
      503,
    );
  }
  static quotaExceeded(message = 'AI usage quota exceeded'): AIError {
    return new AIError('AI_QUOTA_EXCEEDED', message, 429);
  }
}
