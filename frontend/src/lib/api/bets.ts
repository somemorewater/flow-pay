import { api } from './client';
import type { Bet, BetSettlementJob } from '@/types';

export async function getBets(): Promise<Bet[]> {
  const data = await api.get<{ bets: Bet[] }>('/bets');
  return data.bets;
}

export async function getBet(id: string): Promise<Bet> {
  return api.get<Bet>(`/bets/${encodeURIComponent(id)}`);
}

export async function createBet(stake: string, currency: string, odds: string): Promise<Bet> {
  return api.post<Bet>('/bets', { stake, currency, odds });
}

export async function settleBet(id: string): Promise<BetSettlementJob> {
  return api.post<BetSettlementJob>(`/bets/${encodeURIComponent(id)}/settle`, {});
}
