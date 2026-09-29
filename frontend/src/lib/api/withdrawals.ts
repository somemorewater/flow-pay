import { api } from './client';
import type { Withdrawal } from '@/types';

export async function createWithdrawal(params: {
  amount: string;
  currency: string;
  destination?: string;
  network?: string;
}): Promise<Withdrawal> {
  return api.post<Withdrawal>('/withdrawals', params);
}

export async function getWithdrawals(): Promise<Withdrawal[]> {
  const data = await api.get<{ withdrawals: Withdrawal[] }>('/withdrawals');
  return data.withdrawals;
}
