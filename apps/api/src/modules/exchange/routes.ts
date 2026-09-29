import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { pool, withTx } from '../../lib/db.js';
import { commitLedger } from '../../lib/ledger.js';
import { ensureBalanceRow } from '../../lib/wallets.js';
import { config } from '../../lib/config.js';
import { getIdempotentReplay, storeIdempotentResponse, idempotencyKeyOf } from '../../lib/idempotency.js';

const SUPPORTED = ['NGN', 'USD', 'EUR', 'GBP', 'USDC', 'SOL'];

const quoteSchema = z.object({
  from: z.string().min(3).max(8),
  to: z.string().min(3).max(8),
  amount: z.string().regex(/^\d+(\.\d{1,9})?$/),
});

async function getRate(from: string, to: string): Promise<Decimal> {
  if (from === to) return new Decimal(1);
  const r = await pool.query(`SELECT rate FROM exchange_rates WHERE base = $1 AND quote = $2`, [from, to]);
  if (!r.rowCount) throw Object.assign(new Error(`No rate configured for ${from}→${to}.`), { statusCode: 400 });
  return new Decimal(String(r.rows[0].rate));
}

function applyFee(gross: Decimal): { fee: Decimal; receive: Decimal } {
  const fee = gross.mul(config.exchangeFeeBps).div(10000);
  return { fee, receive: gross.minus(fee) };
}

export async function exchangeRoutes(app: FastifyInstance) {
  app.get('/rates', async (_req, reply) => {
    const r = await pool.query(`SELECT base, quote, rate, updated_at FROM exchange_rates ORDER BY base, quote`);
    return reply.send({ success: true, data: { rates: r.rows, note: 'Mock rates for MVP — NOT live market data.' } });
  });

  app.post('/quote', { onRequest: [app.authenticate] }, async (req, reply) => {
    const parsed = quoteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid quote request.' } });
    const from = parsed.data.from.toUpperCase();
    const to = parsed.data.to.toUpperCase();
    if (!SUPPORTED.includes(from) || !SUPPORTED.includes(to)) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: `Supported: ${SUPPORTED.join(', ')}.` } });
    }
    try {
      const rate = await getRate(from, to);
      const gross = new Decimal(parsed.data.amount).mul(rate);
      const { fee, receive } = applyFee(gross);
      return reply.send({ success: true, data: { from, to, amount: parsed.data.amount, rate: rate.toString(), fee: fee.toString(), receive: receive.toString() } });
    } catch (e: any) {
      return reply.code(e?.statusCode ?? 400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: e.message } });
    }
  });

  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub: string };
    const parsed = quoteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid exchange request.' } });
    const from = parsed.data.from.toUpperCase();
    const to = parsed.data.to.toUpperCase();
    const amount = new Decimal(parsed.data.amount);
    if (amount.lte(0)) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Amount must be positive.' } });
    if (!SUPPORTED.includes(from) || !SUPPORTED.includes(to)) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: `Supported: ${SUPPORTED.join(', ')}.` } });
    }
    if (from === to) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'from and to must differ.' } });

    const idemKey = idempotencyKeyOf(req);
    if (idemKey) {
      const replay = await getIdempotentReplay(user.sub, idemKey);
      if (replay) return reply.send({ success: true, data: replay });
    }

    let rate: Decimal;
    try {
      rate = await getRate(from, to);
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: e.message } });
    }
    const gross = amount.mul(rate);
    const { fee, receive } = applyFee(gross);

    try {
      const data = await withTx(async (client) => {
        const fromBal = await ensureBalanceRow(client, user.sub, from);
        const toBal = await ensureBalanceRow(client, user.sub, to);
        if (new Decimal(fromBal.balance).lt(amount)) throw Object.assign(new Error('Insufficient funds.'), { statusCode: 400, code: 'INSUFFICIENT_FUNDS' });
        const refId = `ex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        // Ledger A (from currency): user debit, house credit
        await commitLedger(client, { description: `Exchange ${from}→${to} debit`, referenceType: 'exchange', referenceId: refId }, [
          { accountType: 'user', accountRef: fromBal.balanceId, currency: from, debit: amount.toString() },
          { accountType: 'house', accountRef: `house:${from}`, currency: from, credit: amount.toString() },
        ]);
        // Ledger B (to currency): house debit (gross), user credit (receive) + fee credit
        await commitLedger(client, { description: `Exchange ${from}→${to} credit`, referenceType: 'exchange', referenceId: refId }, [
          { accountType: 'house', accountRef: `house:${to}`, currency: to, debit: gross.toString() },
          { accountType: 'user', accountRef: toBal.balanceId, currency: to, credit: receive.toString() },
          { accountType: 'fee', accountRef: `fee:${to}`, currency: to, credit: fee.toString() },
        ]);
        await client.query(
          `INSERT INTO transactions (user_id, type, currency, amount, status, reference_type, reference_id)
           VALUES ($1,'exchange',$2,$3,'completed','exchange',$4)`,
          [user.sub, to, receive.toString(), refId],
        );
        return { from, to, amount: amount.toString(), rate: rate.toString(), fee: fee.toString(), receive: receive.toString(), referenceId: refId };
      });
      if (idemKey) await storeIdempotentResponse(user.sub, idemKey, data);
      return reply.code(201).send({ success: true, data });
    } catch (e: any) {
      const code = e?.code ?? 'INTERNAL_ERROR';
      return reply.code(e?.statusCode ?? 500).send({ success: false, error: { code, message: e.message ?? 'Exchange failed.' } });
    }
  });
}
