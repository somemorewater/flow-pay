import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { pool, withTx } from '../../lib/db.js';
import { commitLedger } from '../../lib/ledger.js';
import { ensureBalanceRow, SUPPORTED_CURRENCIES } from '../../lib/wallets.js';
import { enqueueSettlementJob } from '../../lib/redis.js';
import { getIdempotentReplay, storeIdempotentResponse, idempotencyKeyOf } from '../../lib/idempotency.js';

const createSchema = z.object({
  stake: z.string().regex(/^\d+(\.\d{1,9})?$/),
  currency: z.string().min(3).max(8),
  odds: z.string().regex(/^\d+(\.\d{1,9})?$/),
});

export async function betRoutes(app: FastifyInstance) {
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub: string };
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid bet request.' } });
    const currency = parsed.data.currency.toUpperCase();
    if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(currency)) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: `Currency must be one of ${SUPPORTED_CURRENCIES.join(', ')}.` } });
    }
    const stake = new Decimal(parsed.data.stake);
    const odds = new Decimal(parsed.data.odds);
    if (stake.lte(0)) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Stake must be positive.' } });
    if (odds.lte(1)) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Odds must be greater than 1.' } });

    const idemKey = idempotencyKeyOf(req);
    if (idemKey) {
      const replay = await getIdempotentReplay(user.sub, idemKey);
      if (replay) return reply.send({ success: true, data: replay });
    }

    try {
      const data = await withTx(async (client) => {
        const bal = await ensureBalanceRow(client, user.sub, currency);
        if (new Decimal(bal.balance).lt(stake)) {
          throw Object.assign(new Error('Insufficient funds.'), { statusCode: 400, code: 'INSUFFICIENT_FUNDS' });
        }
        const betR = await client.query(
          `INSERT INTO bets (user_id, stake, currency, odds, status) VALUES ($1,$2,$3,$4,'pending') RETURNING *`,
          [user.sub, stake.toString(), currency, odds.toString()],
        );
        const bet = betR.rows[0];
        await commitLedger(client, { description: `Bet stake ${bet.id}`, referenceType: 'bet', referenceId: bet.id }, [
          { accountType: 'user', accountRef: bal.balanceId, currency, debit: stake.toString() },
          { accountType: 'escrow', accountRef: `escrow:${currency}`, currency, credit: stake.toString() },
        ]);
        await client.query(
          `INSERT INTO transactions (user_id, type, currency, amount, status, reference_type, reference_id)
           VALUES ($1,'bet',$2,$3,'pending','bet',$4)`,
          [user.sub, currency, stake.toString(), bet.id],
        );
        return { ...bet, stake: String(bet.stake), odds: String(bet.odds) };
      });
      if (idemKey) await storeIdempotentResponse(user.sub, idemKey, data);
      return reply.code(201).send({ success: true, data });
    } catch (e: any) {
      return reply.code(e?.statusCode ?? 500).send({ success: false, error: { code: e?.code ?? 'INTERNAL_ERROR', message: e.message } });
    }
  });

  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub: string };
    const r = await pool.query(`SELECT * FROM bets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [user.sub]);
    return reply.send({ success: true, data: { bets: r.rows.map((b) => ({ ...b, stake: String(b.stake), odds: String(b.odds), payout: b.payout == null ? null : String(b.payout) })) } });
  });

  app.get('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub: string };
    const { id } = req.params as { id: string };
    const r = await pool.query(`SELECT * FROM bets WHERE id = $1 AND user_id = $2`, [id, user.sub]);
    if (!r.rowCount) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Bet not found.' } });
    const b = r.rows[0];
    return reply.send({ success: true, data: { ...b, stake: String(b.stake), odds: String(b.odds), payout: b.payout == null ? null : String(b.payout) } });
  });

  // Enqueue settlement job for the Rust worker (async settlement).
  app.post('/:id/settle', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub: string };
    const { id } = req.params as { id: string };
    const r = await pool.query(`SELECT * FROM bets WHERE id = $1 AND user_id = $2`, [id, user.sub]);
    if (!r.rowCount) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Bet not found.' } });
    const bet = r.rows[0];
    if (bet.status !== 'pending') {
      return reply.code(409).send({ success: false, error: { code: 'CONFLICT', message: `Bet already settled (${bet.status}).` } });
    }
    const s = await pool.query(
      `INSERT INTO settlements (bet_id, stake, status) VALUES ($1,$2,'pending')
       ON CONFLICT (bet_id) DO UPDATE SET bet_id = EXCLUDED.bet_id RETURNING *`,
      [id, String(bet.stake)],
    );
    const settlement = s.rows[0];
    if (settlement.status === 'completed') {
      return reply.code(409).send({ success: false, error: { code: 'CONFLICT', message: 'Bet already settled.' } });
    }
    await enqueueSettlementJob(id, settlement.id);
    return reply.code(202).send({ success: true, data: { betId: id, settlementId: settlement.id, status: 'pending', note: 'Settlement job queued for the Rust worker.' } });
  });
}
