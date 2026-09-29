import { api } from './client';
import type { ApiPayment, PaymentIntent, PaymentVerification } from '@/types';

export async function createPaymentIntent(params: {
  amount: string;
  currency: string;
  type: 'fiat' | 'crypto';
  senderAddress?: string;
}): Promise<PaymentIntent> {
  return api.post<PaymentIntent>('/payments/intents', params);
}

export async function getPayment(id: string): Promise<PaymentIntent> {
  return api.get<PaymentIntent>(`/payments/${encodeURIComponent(id)}`);
}

export async function getPayments(limit = 50): Promise<ApiPayment[]> {
  const data = await api.get<{ payments: ApiPayment[] }>(`/payments?limit=${limit}`);
  return data.payments;
}

export async function verifyPayment(id: string, signature: string): Promise<PaymentVerification> {
  return api.post<PaymentVerification>(
    `/payments/${encodeURIComponent(id)}/verify`,
    { signature },
    { auth: true },
  );
}

export async function getSolanaBalance(address: string): Promise<{ address: string; balance: string; network: string }> {
  return api.get(`/payments/solana/balance?address=${encodeURIComponent(address)}`);
}

export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}
