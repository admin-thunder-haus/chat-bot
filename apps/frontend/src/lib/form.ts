import { ApiClientError } from './api';

export interface ParsedApiError {
  message: string;
  fieldErrors: Record<string, string>;
}

/** Turn any thrown value into a friendly message + per-field errors. */
export function parseApiError(err: unknown): ParsedApiError {
  if (err instanceof ApiClientError) {
    const fieldErrors: Record<string, string> = {};
    for (const e of err.errors) {
      if (e.field) fieldErrors[e.field] = e.message;
    }
    return { message: err.message, fieldErrors };
  }
  return {
    message: 'Something went wrong. Please try again.',
    fieldErrors: {},
  };
}
