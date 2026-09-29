import type { PoolClient } from 'pg';
import { pool } from '../lib/db.js';

export const SUPPORTED_CURRENCIES = ['USD', 'NGN', 'EUR', 'GBP', 'SOL', 'USDC'] as const;

/** Ensure wallet container + per-currency balance row exist; returns wallet_balances.id */
export async function ensureBalanceRow(
  executor: PoolClient | typeof pool,
  userId: string,
  currency: string,
): Promise<{ walletId: string; balanceId: string; balance: string }> {
  const w = await executor.query(`SELECT id FROM wallets WHERE user_id = $1`, [userId]);
  let walletId: string;
  if (w.rowCount === 0) {
    const ins = await executor.query(`INSERT INTO wallets (user_id) VALUES ($1) RETURNING id`, [userId]);
    walletId = ins.rows[0].id;
  } else {
    walletId = w.rows[0].id;
  }
  const b = await executor.query(`SELECT id, balance FROM wallet_balances WHERE wallet_id = $1 AND currency = $2`, [
    walletId,
    currency,
  ]);
  if (b.rowCount === 0) {
    const ins = await executor.query(
      `INSERT INTO wallet_balances (wallet_id, currency, balance) VALUES ($1,$2,0) RETURNING id, balance`,
      [walletId, currency],
    );
    return { walletId, balanceId: ins.rows[0].id, balance: String(ins.rows[0].balance) };
  }
  return { walletId, balanceId: b.rows[0].id, balance: String(b.rows[0].balance) };
}

export async function getWalletView(userId: string) {
  const w = await pool.query(`SELECT id FROM wallets WHERE user_id = $1`, [userId]);
  let walletId: string | null = w.rows[0]?.id ?? null;
  if (!walletId) {
    const ins = await pool.query(`INSERT INTO wallets (user_id) VALUES ($1) RETURNING id`, [userId]);
    walletId = ins.rows[0].id;
  }
  const rows = await pool.query(
    `SELECT currency, balance, updated_at FROM wallet_balances WHERE wallet_id = $1 ORDER BY currency`,
    [walletId],
  );
  const balances: Record<string, string> = {};
  for (const c of SUPPORTED_CURRENCIES) balances[c] = '0';
  for (const r of rows.rows) balances[r.currency] = String(r.balance);
  return { id: walletId, balances };
}
