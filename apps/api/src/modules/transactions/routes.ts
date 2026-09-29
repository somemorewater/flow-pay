import type { FastifyInstance } from 'fastify';
import { pool } from '../../lib/db.js';
import { SUPPORTED_CURRENCIES } from '../../lib/wallets.js';

const TX_TYPES = ['deposit', 'withdrawal', 'payment', 'bet', 'settlement', 'exchange'];
const TX_STATUSES = ['pending', 'processing', 'completed', 'failed', 'expired'];

export async function transactionRoutes(app: FastifyInstance) {
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub: string };
    const q = req.query as { type?: string; currency?: string; status?: string; from?: string; to?: string; limit?: string };
    if (q.type && !TX_TYPES.includes(q.type)) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: `Invalid type filter. Must be one of ${TX_TYPES.join(', ')}.` } });
    }
    if (q.currency && !(SUPPORTED_CURRENCIES as readonly string[]).includes(q.currency.toUpperCase())) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: `Invalid currency filter. Must be one of ${SUPPORTED_CURRENCIES.join(', ')}.` } });
    }
    if (q.status && !TX_STATUSES.includes(q.status)) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: `Invalid status filter. Must be one of ${TX_STATUSES.join(', ')}.` } });
    }
    if (q.from && isNaN(Date.parse(q.from))) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid from date.' } });
    }
    if (q.to && isNaN(Date.parse(q.to))) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid to date.' } });
    }
    const conds = ['user_id = $1'];
    const params: any[] = [user.sub];
    let i = 2;
    if (q.type) { conds.push(`type = $${i++}`); params.push(q.type); }
    if (q.currency) { conds.push(`currency = $${i++}`); params.push(q.currency.toUpperCase()); }
    if (q.status) { conds.push(`status = $${i++}`); params.push(q.status); }
    if (q.from) { conds.push(`created_at >= $${i++}`); params.push(q.from); }
    if (q.to) { conds.push(`created_at <= $${i++}`); params.push(q.to); }
    const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 200);
    const r = await pool.query(
      `SELECT * FROM transactions WHERE ${conds.join(' AND ')} ORDER BY created_at DESC LIMIT ${limit}`,
      params,
    );
    return reply.send({ success: true, data: { transactions: r.rows } });
  });

  app.get('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub: string };
    const { id } = req.params as { id: string };
    const r = await pool.query(`SELECT * FROM transactions WHERE id = $1 AND user_id = $2`, [id, user.sub]);
    if (!r.rowCount) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Transaction not found.' } });
    return reply.send({ success: true, data: r.rows[0] });
  });
}
