import Redis from 'ioredis';
import { config } from './config.js';

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

export const SETTLEMENT_QUEUE = 'flowpay:settlement:jobs';

export async function checkRedis(): Promise<boolean> {
  try {
    const p = await redis.ping();
    return p === 'PONG';
  } catch {
    return false;
  }
}

export async function enqueueSettlementJob(betId: string, settlementId: string): Promise<void> {
  await redis.rpush(SETTLEMENT_QUEUE, JSON.stringify({ betId, settlementId, enqueuedAt: new Date().toISOString() }));
}
