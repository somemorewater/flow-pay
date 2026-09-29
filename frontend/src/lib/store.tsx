// App data store. The backend (PostgreSQL) is the source of truth for all
// financial state — this only caches API responses and refetches after
// mutations.
'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getWallet } from './api/wallet';
import { getTransactions } from './api/transactions';
import { getToken } from './api/client';
import { useAuth } from './auth';
import type { ApiTransaction, WalletView } from '@/types';

interface AppCtx {
  wallet: WalletView | null;
  txns: ApiTransaction[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [txns, setTxns] = useState<ApiTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setWallet(null);
      setTxns([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [w, t] = await Promise.all([getWallet(), getTransactions({ limit: 50 })]);
      setWallet(w);
      setTxns(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load wallet data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) refresh();
    else {
      setWallet(null);
      setTxns([]);
    }
  }, [user, refresh]);

  return <Ctx.Provider value={{ wallet, txns, loading, error, refresh }}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('AppProvider missing');
  return c;
}

/** Numeric balance for a currency from the wallet view (decimal strings). */
export function balanceOf(wallet: WalletView | null, currency: string): number {
  if (!wallet) return 0;
  const v = Number(wallet.balances[currency] ?? 0);
  return isFinite(v) ? v : 0;
}
