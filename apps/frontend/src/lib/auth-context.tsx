'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, setAccessToken, setOnAuthFailure } from './api';
import { DEFAULT_FEATURES, type Company, type PlatformFeatures, type User } from './types';

interface AuthState {
  user: User | null;
  company: Company | null;
  /**
   * Platform module switches from the backend. Until a payload arrives this is
   * DEFAULT_FEATURES, which hides the optional modules — better to reveal
   * Billing a moment late than to link to a page the API answers 410 for.
   */
  features: PlatformFeatures;
  // True while the initial silent-refresh check is in flight.
  initializing: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    companyName: string;
    fullName: string;
    email: string;
    password: string;
    confirmPassword: string;
  }) => Promise<{ requiresEmailVerification: boolean }>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** State for a signed-in session, from any auth payload that carries tokens. */
function signedIn(data: {
  user: User;
  company: Company;
  features?: PlatformFeatures;
}): AuthState {
  return {
    user: data.user,
    company: data.company,
    features: data.features ?? DEFAULT_FEATURES,
    initializing: false,
  };
}

/** State for "no session" — features fall back to the conservative defaults. */
const SIGNED_OUT: AuthState = {
  user: null,
  company: null,
  features: DEFAULT_FEATURES,
  initializing: false,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    ...SIGNED_OUT,
    initializing: true,
  });

  // When a token refresh definitively fails mid-session, clear auth state.
  // The dashboard layout then redirects to /login (once) on the next render.
  useEffect(() => {
    setOnAuthFailure(() => {
      setState(SIGNED_OUT);
    });
    return () => setOnAuthFailure(null);
  }, []);

  // On first load, try to restore a session from the httpOnly refresh cookie.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await api.refresh();
        setAccessToken(data.accessToken);
        if (active) setState(signedIn(data));
      } catch {
        if (active) setState(SIGNED_OUT);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.login({ email, password });
    setAccessToken(data.accessToken);
    setState(signedIn(data));
  }, []);

  const register = useCallback(
    async (input: {
      companyName: string;
      fullName: string;
      email: string;
      password: string;
      confirmPassword: string;
    }) => {
      const data = await api.register(input);

      // While email verification is enforced the backend issues no tokens;
      // the caller routes the user to the verify-email step instead.
      if (data.requiresEmailVerification || !data.accessToken) {
        return { requiresEmailVerification: true };
      }

      setAccessToken(data.accessToken);
      setState(signedIn(data));
      return { requiresEmailVerification: false };
    },
    [],
  );

  const verifyEmail = useCallback(async (email: string, code: string) => {
    const data = await api.verifyEmail({ email, code });
    setAccessToken(data.accessToken);
    setState(signedIn(data));
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setAccessToken(null);
      setState(SIGNED_OUT);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, register, verifyEmail, logout }),
    [state, login, register, verifyEmail, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
