import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, request } from './api';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request()', () => {
  it('unwraps the data envelope on success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { success: true, message: 'ok', data: { id: '1' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(request<{ id: string }>('/things')).resolves.toEqual({
      id: '1',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('throws ApiClientError carrying status, errors, and the machine code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(403, {
          success: false,
          message: 'Please verify your email address before logging in',
          errors: [],
          requestId: 'r1',
          code: 'EMAIL_NOT_VERIFIED',
        }),
      ),
    );

    const err = await request('/auth/login', {
      method: 'POST',
      body: { email: 'a@b.c', password: 'x' },
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiClientError);
    const apiErr = err as ApiClientError;
    expect(apiErr.status).toBe(403);
    expect(apiErr.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('serializes JSON bodies with a Content-Type header', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { success: true, message: 'ok', data: null }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await request('/things', { method: 'POST', body: { a: 1 } });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it('passes FormData through untouched without a JSON Content-Type', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { success: true, message: 'ok', data: null }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const form = new FormData();
    form.append('mode', 'merge');
    await request('/services/import', { method: 'POST', body: form });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBe(form);
  });
});
