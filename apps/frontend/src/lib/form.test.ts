import { describe, expect, it } from 'vitest';
import { parseApiError } from './form';
import { ApiClientError } from './api';

describe('parseApiError', () => {
  it('maps an ApiClientError to message + field errors', () => {
    const err = new ApiClientError('Validation failed', 400, [
      { field: 'email', message: 'A valid email address is required' },
      { field: 'confirmPassword', message: 'Passwords do not match' },
      { message: 'general problem' },
    ]);
    expect(parseApiError(err)).toEqual({
      message: 'Validation failed',
      fieldErrors: {
        email: 'A valid email address is required',
        confirmPassword: 'Passwords do not match',
      },
    });
  });

  it('falls back to a generic message for unknown errors', () => {
    expect(parseApiError(new Error('boom'))).toEqual({
      message: 'Something went wrong. Please try again.',
      fieldErrors: {},
    });
  });
});
