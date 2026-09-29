import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { pool, withTx } from '../../lib/db.js';
import { commitLedger } from '../../lib/ledger.js';
import { ensureBalanceRow } from '../../lib/wallets.js';
import { validateSolanaAddress } from '../solana/service.js';
import { getIdempotentReplay, storeIdempotentResponse, idempotencyKeyOf } from '../../lib/idempotency.js';

const createSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,9})?$/),
  currency: z.string().min(3).max(8),
  network: z.string().optional(),
  destination: z.string().optional(),
});

export async function withdrawalRoutes(app: FastifyInstance) {
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub: string };
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid withdrawal request.' } });
    const currency = parsed.data.currency.toUpperCase();
    const amount = new Decimal(parsed.data.amount);
    if (amount.lte(0)) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Amount must be positive.' } });

    const isCrypto = currency === 'SOL' || currency === 'USDC';
    const network = (parsed.data.network ?? (isCrypto ? 'solana-devnet' : 'mock-fiat')).toLowerCase();
    const destination = parsed.data.destination;

    if (isCrypto) {
      if (!destination || !validateSolanaAddress(destination)) {
        return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Valid Solana destination address required for crypto withdrawals.' } });
      }
      // MVP: record + reserve funds via ledger; on-chain payout is a known limitation
      // (user-signed deposits are the REAL devnet path in this MVP).
    }

    const idemKey = idempotencyKeyOf(req);
    if (idemKey) {
      const replay = await getIdempotentReplay(user.sub, idemKey);
      if (replay) return reply.send({ success: true, data: replay });
    }

    try {
      const data = await withTx(async (client) => {
        const bal = await ensureBalanceRow(client, user.sub, currency);
        if (new Decimal(bal.balance).lt(amount)) {
          throw Object.assign(new Error('Insufficient funds.'), { statusCode: 400, code: 'INSUFFICIENT_FUNDS' });
        }
        const wR = await client.query(
          `INSERT INTO withdrawals (user_id, currency, network, destination, amount, status)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [user.sub, currency, network, destination ?? null, amount.toString(), isCrypto ? 'processing' : 'completed'],
        );
        const w = wR.rows[0];
        await commitLedger(client, { description: `Withdrawal ${w.id}`, referenceType: 'withdrawal', referenceId: w.id }, [
          { accountType: 'user', accountRef: bal.balanceId, currency, debit: amount.toString() },
          { accountType: 'house', accountRef: `house:${currency}`, currency, credit: amount.toString() },
        ]);
        await client.query(
          `INSERT INTO transactions (user_id, type, currency, amount, status, reference_type, reference_id)
           VALUES ($1,'withdrawal',$2,$3,$4,'withdrawal',$5)`,
          [user.sub, currency, amount.toString(), isCrypto ? 'processing' : 'completed', w.id],
        );
        return {
          ...w,
          amount: String(w.amount),
          note: isCrypto
            ? 'Crypto withdrawal recorded (funds reserved). On-chain payout from treasury is a known MVP limitation — devnet deposits are the live path.'
            : 'SIMULATED fiat withdrawal (mock provider).',
        };
      });
      if (idemKey) await storeIdempotentResponse(user.sub, idemKey, data);
      return reply.code(201).send({ success: true, data });
    } catch (e: any) {
      return reply.code(e?.statusCode ?? 500).send({ success: false, error: { code: e?.code ?? 'INTERNAL_ERROR', message: e.message } });
    }
  });

  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub: string };
    const r = await pool.query(`SELECT * FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [user.sub]);
    return reply.send({ success: true, data: { withdrawals: r.rows.map((w) => ({ ...w, amount: String(w.amount) })) } });
  });
}
