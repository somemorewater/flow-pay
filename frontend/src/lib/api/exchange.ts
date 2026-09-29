import { api } from './client';
import type { ExchangeQuote, ExchangeRateRow, ExchangeResult } from '@/types';

export async function getExchangeRates(): Promise<ExchangeRateRow[]> {
  const data = await api.get<{ rates: ExchangeRateRow[]; note?: string }>('/exchange/rates', false);
  return data.rates;
}

export async function createExchangeQuote(from: string, to: string, amount: string): Promise<ExchangeQuote> {
  return api.post<ExchangeQuote>('/exchange/quote', { from, to, amount });
}

export async function executeExchange(from: string, to: string, amount: string): Promise<ExchangeResult> {
  return api.post<ExchangeResult>('/exchange', { from, to, amount });
}
