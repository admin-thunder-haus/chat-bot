/** Result of processing an inbound webhook POST. */
export interface WebhookProcessingResult {
  acknowledged: boolean;
  processed: number;
  duplicates: number;
  ignored: number;
  failed: number;
}

/** Result of a GET verification challenge. */
export interface WebhookVerificationOutcome {
  verified: boolean;
  challenge: string;
}
