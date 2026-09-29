import { api } from './client';
import type { LedgerEntry, WalletView } from '@/types';

export async function getWallet(): Promise<WalletView> {
  const data = await api.get<{ wallet: WalletView }>('/wallets');
  return data.wallet;
}

export async function getWalletLedger(currency?: string): Promise<LedgerEntry[]> {
  const qs = currency ? `?currency=${encodeURIComponent(currency)}` : '';
  const data = await api.get<{ entries: LedgerEntry[] }>(`/wallets/ledger${qs}`);
  return data.entries;
}
