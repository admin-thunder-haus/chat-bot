import OpenAI, { toFile } from 'openai';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

/**
 * Voice-note transcription (OpenAI Whisper). Fully optional and fail-safe: it
 * returns null (never throws) when the AI feature or transcription is disabled,
 * when no API key is configured, or when the provider errors — a voice message
 * is then stored without a transcript instead of failing the webhook.
 */

export interface TranscriptionInput {
  buffer: Buffer;
  mimeType: string;
  fileName?: string;
}

export interface TranscriptionResult {
  text: string;
  model: string;
}

export type Transcriber = (
  input: TranscriptionInput,
) => Promise<TranscriptionResult | null>;

// Test override: automated tests inject a fake transcriber so the real OpenAI
// API is never called. Set to null to restore normal resolution.
let testOverride: Transcriber | null = null;
export function setTranscriberForTesting(fn: Transcriber | null): void {
  testOverride = fn;
}

let singleton: OpenAI | null = null;

function getClient(apiKey: string): OpenAI {
  if (!singleton) {
    singleton = new OpenAI({
      apiKey,
      timeout: env.OPENAI_TIMEOUT_MS,
      maxRetries: env.OPENAI_MAX_RETRIES,
    });
  }
  return singleton;
}

export const aiTranscriptionService = {
  /** Transcribe an audio buffer. Returns null when disabled or on failure. */
  async transcribe(
    input: TranscriptionInput,
  ): Promise<TranscriptionResult | null> {
    if (testOverride) return testOverride(input);
    if (
      !env.AI_FEATURE_ENABLED ||
      !env.AI_TRANSCRIPTION_ENABLED ||
      !env.OPENAI_API_KEY
    ) {
      return null;
    }
    try {
      const client = getClient(env.OPENAI_API_KEY);
      const result = await client.audio.transcriptions.create({
        file: await toFile(input.buffer, input.fileName ?? 'voice.ogg', {
          type: input.mimeType,
        }),
        model: env.OPENAI_TRANSCRIPTION_MODEL,
      });
      const text = (result.text ?? '').trim();
      if (!text) return null;
      return { text, model: env.OPENAI_TRANSCRIPTION_MODEL };
    } catch (err) {
      // Provider/network failure — the voice message stays without transcript.
      logger.warn('ai.transcription.error', {
        error: err instanceof Error ? err.message : 'unknown',
      });
      return null;
    }
  },
};
