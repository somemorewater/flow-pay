// Authentication state backed by the real backend (JWT).
// Token lives in localStorage; requests attach `Authorization: Bearer <token>`.
'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getCurrentUser, login as apiLogin, logout as apiLogout, register as apiRegister } from './api/auth';
import { ApiError, getToken } from './api/client';
import type { User } from '@/types';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  error: string;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshUser = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await getCurrentUser());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        apiLogout();
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    setError('');
    try {
      const { user: u } = await apiLogin(email, password);
      setUser(u);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Login failed.';
      setError(msg);
      throw e;
    }
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    setError('');
    try {
      const { user: u } = await apiRegister(email, password);
      setUser(u);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Registration failed.';
      setError(msg);
      throw e;
    }
  }, []);

  const logout = useCallback(() => {
    apiLogout();
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, loading, error, login, register, logout, refreshUser }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
}
