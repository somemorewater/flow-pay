// Static frontend constants only. Balances, transactions, payments, bets
// and rates all come from the backend API — nothing here is a data source.
import type { Currency } from '@/types';

export const CURRENCIES: Currency[] = ['USD', 'NGN', 'EUR', 'GBP', 'SOL', 'USDC'];
export const FIAT_CURRENCIES: Currency[] = ['USD', 'NGN', 'EUR', 'GBP'];
export const CRYPTO_ASSETS: Currency[] = ['SOL', 'USDC'];
