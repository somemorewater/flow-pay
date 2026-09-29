import type { FastifyRequest } from 'fastify';
import { pool } from './db.js';
import { redis } from './redis.js';

const TTL_SECONDS = 24 * 3600;

function redisKey(userId: string, key: string) {
  return `flowpay:idempotency:${userId}:${key}`;
}

/** Returns stored response if this key was already processed, else null. */
export async function getIdempotentReplay(userId: string, key: string | undefined): Promise<any | null> {
  if (!key) return null;
  const cached = await redis.get(redisKey(userId, key));
  if (cached) return JSON.parse(cached);
  const r = await pool.query(`SELECT response FROM idempotency_keys WHERE key = $1`, [`${userId}:${key}`]);
  if (r.rowCount) {
    await redis.setex(redisKey(userId, key), TTL_SECONDS, JSON.stringify(r.rows[0].response));
    return r.rows[0].response;
  }
  return null;
}

export async function storeIdempotentResponse(userId: string, key: string | undefined, response: any): Promise<void> {
  if (!key) return;
  const full = `${userId}:${key}`;
  await pool.query(
    `INSERT INTO idempotency_keys (key, user_id, response) VALUES ($1,$2,$3)
     ON CONFLICT (key) DO NOTHING`,
    [full, userId, JSON.stringify(response)],
  );
  await redis.setex(redisKey(userId, key), TTL_SECONDS, JSON.stringify(response));
}

export function idempotencyKeyOf(req: FastifyRequest): string | undefined {
  const h = req.headers['idempotency-key'];
  if (Array.isArray(h)) return h[0];
  return h;
}
