import type { ApiError, ApiSuccess, AuthData, User, Company } from './types';

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ||
  'http://localhost:4000';

const API_PREFIX = '/api/v1';

// Access token is kept in memory only (never localStorage). The refresh token
// lives in an httpOnly cookie managed by the backend.
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

// Registered by the AuthProvider; invoked once when a refresh definitively
// fails so the app can clear auth state and redirect to login.
let onAuthFailure: (() => void) | null = null;
export function setOnAuthFailure(fn: (() => void) | null): void {
  onAuthFailure = fn;
}

/** Error thrown for any non-2xx API response, carrying field-level details. */
export class ApiClientError extends Error {
  status: number;
  errors: { field?: string; message: string }[];

  constructor(
    message: string,
    status: number,
    errors: { field?: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.errors = errors;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean; // attach the access token
  retryOnUnauthorized?: boolean; // internal: attempt a token refresh once
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    method = 'GET',
    body,
    auth = false,
    retryOnUnauthorized = true,
  } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE_URL}${API_PREFIX}${path}`, {
    method,
    headers,
    // Always include credentials so the httpOnly refresh cookie flows.
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Transparently refresh the access token once on a 401 for authed calls.
  if (res.status === 401 && auth && retryOnUnauthorized) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return request<T>(path, { ...options, retryOnUnauthorized: false });
    }
  }

  const payload = (await parseJson(res)) as
    | ApiSuccess<T>
    | ApiError
    | null;

  if (!res.ok || !payload || payload.success === false) {
    const errBody = payload as ApiError | null;
    throw new ApiClientError(
      errBody?.message || `Request failed with status ${res.status}`,
      res.status,
      errBody?.errors ?? [],
    );
  }

  return (payload as ApiSuccess<T>).data;
}

// Single-flight refresh: concurrent 401s share ONE in-flight refresh promise
// instead of each firing their own /auth/refresh (which previously caused a
// refresh storm and 429s). The promise resets once settled so a later expiry
// can refresh again.
let refreshPromise: Promise<boolean> | null = null;

/** Attempt a silent token refresh (deduplicated); returns true on success. */
function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const data = await request<AuthData>('/auth/refresh', {
          method: 'POST',
          body: {},
          // The refresh call must never recurse into another refresh.
          retryOnUnauthorized: false,
        });
        setAccessToken(data.accessToken);
        return true;
      } catch {
        setAccessToken(null);
        // Notify the app exactly once so it can clear state + redirect.
        onAuthFailure?.();
        return false;
      }
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export const api = {
  register(input: {
    companyName: string;
    fullName: string;
    email: string;
    password: string;
  }): Promise<AuthData> {
    return request<AuthData>('/auth/register', {
      method: 'POST',
      body: input,
    });
  },

  login(input: { email: string; password: string }): Promise<AuthData> {
    return request<AuthData>('/auth/login', { method: 'POST', body: input });
  },

  logout(): Promise<null> {
    return request<null>('/auth/logout', { method: 'POST', body: {} });
  },

  refresh(): Promise<AuthData> {
    return request<AuthData>('/auth/refresh', {
      method: 'POST',
      body: {},
      retryOnUnauthorized: false,
    });
  },

  me(): Promise<{ user: User; company: Company }> {
    return request<{ user: User; company: Company }>('/auth/me', {
      auth: true,
    });
  },
};
