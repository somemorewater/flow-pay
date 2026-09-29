export type Currency = 'USD' | 'NGN' | 'EUR' | 'GBP' | 'SOL' | 'USDC';

export const SUPPORTED_CURRENCIES: Currency[] = ['USD', 'NGN', 'EUR', 'GBP', 'SOL', 'USDC'];
export const FIAT_CURRENCIES: Currency[] = ['USD', 'NGN', 'EUR', 'GBP'];
export const CRYPTO_ASSETS: Currency[] = ['SOL', 'USDC'];

export interface User {
  id: string;
  email: string;
  created_at?: string;
  updated_at?: string;
}

export interface WalletView {
  id: string;
  balances: Record<string, string>;
}

/** Backend transaction row. Amounts are decimal strings, always >= 0. */
export interface ApiTransaction {
  id: string;
  user_id: string;
  type: 'deposit' | 'withdrawal' | 'payment' | 'bet' | 'settlement' | 'exchange';
  currency: string;
  amount: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'expired';
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
}

export type PaymentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'expired';

export interface PaymentIntent {
  id: string;
  paymentId?: string;
  amount: string;
  currency: string;
  asset?: string;
  type: 'fiat' | 'crypto';
  status: PaymentStatus;
  network: string;
  recipient?: string;
  usdcMint?: string;
  expiresAt?: string;
  explorerHint?: string;
  note?: string;
}

export interface PaymentVerification {
  id: string;
  status: string;
  asset: string;
  amount: string;
  signature: string;
  explorerUrl: string;
}

export interface ApiPayment {
  id: string;
  intentId: string;
  amount: string;
  currency: string;
  type: 'fiat' | 'crypto';
  status: PaymentStatus;
  provider: string;
  createdAt: string;
  updatedAt: string;
  signature: string | null;
  network: string | null;
  explorerUrl?: string;
}

export interface ExchangeRateRow {
  base: string;
  quote: string;
  rate: string;
  updated_at: string;
}

export interface ExchangeQuote {
  from: string;
  to: string;
  amount: string;
  rate: string;
  fee: string;
  receive: string;
}

export interface ExchangeResult extends ExchangeQuote {
  referenceId: string;
}

export type BetStatus = 'pending' | 'settled_won' | 'settled_lost' | 'void';

export interface Bet {
  id: string;
  user_id: string;
  stake: string;
  currency: string;
  odds: string;
  status: BetStatus;
  payout: string | null;
  settlement_id: string | null;
  created_at: string;
  settled_at: string | null;
}

export interface BetSettlementJob {
  betId: string;
  settlementId: string;
  status: string;
  note: string;
}

export interface Withdrawal {
  id: string;
  currency: string;
  network: string;
  destination: string | null;
  amount: string;
  status: string;
  note?: string;
  created_at: string;
}
