import { api } from './client';
import type { ApiTransaction } from '@/types';

export interface TransactionFilters {
  type?: string;
  currency?: string;
  status?: string;
  limit?: number;
}

export async function getTransactions(filters: TransactionFilters = {}): Promise<ApiTransaction[]> {
  const qs = new URLSearchParams();
  if (filters.type) qs.set('type', filters.type);
  if (filters.currency) qs.set('currency', filters.currency);
  if (filters.status) qs.set('status', filters.status);
  qs.set('limit', String(filters.limit ?? 50));
  const data = await api.get<{ transactions: ApiTransaction[] }>(`/transactions?${qs.toString()}`);
  return data.transactions;
}

export async function getTransaction(id: string): Promise<ApiTransaction> {
  return api.get<ApiTransaction>(`/transactions/${encodeURIComponent(id)}`);
}
