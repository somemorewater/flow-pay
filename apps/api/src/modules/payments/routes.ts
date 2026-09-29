import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { randomBytes } from 'crypto';
import { pool, withTx } from '../../lib/db.js';
import { commitLedger } from '../../lib/ledger.js';
import { ensureBalanceRow } from '../../lib/wallets.js';
import { getIdempotentReplay, storeIdempotentResponse, idempotencyKeyOf } from '../../lib/idempotency.js';
import { config } from '../../lib/config.js';
import { verifyDevnetTransfer, explorerTxUrl, validateSolanaAddress } from '../solana/service.js';

const FIAT = ['NGN', 'USD', 'EUR', 'GBP'];
const CRYPTO = ['SOL', 'USDC'];

const intentSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,9})?$/, 'Amount must be a decimal string.'),
  currency: z.string().min(3).max(8),
  type: z.enum(['fiat', 'crypto']),
  senderAddress: z.string().optional(),
});

function newIntentId(): string {
  return `pi_${randomBytes(12).toString('hex')}`;
}

export async function paymentRoutes(app: FastifyInstance) {
  // Create payment intent (idempotent via Idempotency-Key header)
  app.post('/intents', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub: string };
    const parsed = intentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input.' } });
    }
    const { amount, currency, type, senderAddress } = parsed.data;
    const ccy = currency.toUpperCase();
    let amountDec: Decimal;
    try {
      amountDec = new Decimal(amount);
      if (!amountDec.isFinite() || amountDec.lte(0)) throw new Error();
    } catch {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid amount.' } });
    }

    if (type === 'fiat' && !FIAT.includes(ccy)) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: `Fiat currency must be one of ${FIAT.join(', ')}.` } });
    }
    if (type === 'crypto' && !CRYPTO.includes(ccy)) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: `Crypto currency must be one of ${CRYPTO.join(', ')}.` } });
    }
    if (senderAddress && !validateSolanaAddress(senderAddress)) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid senderAddress.' } });
    }

    const idemKey = idempotencyKeyOf(req);
    if (idemKey) {
      const replay = await getIdempotentReplay(user.sub, idemKey);
      if (replay) return reply.send({ success: true, data: replay });
    }

    const intentId = newIntentId();
    const isCrypto = type === 'crypto';
    const network = isCrypto ? config.solanaNetwork : 'mock-fiat';
    const recipient = isCrypto ? config.treasuryAddress : 'flowpay-fiat-acquirer';

    if (isCrypto && !recipient) {
      return reply.code(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'FLOWPAY_TREASURY_ADDRESS is not configured.' } });
    }

    const out = await withTx(async (client) => {
      await client.query(
        `INSERT INTO payment_intents (id, user_id, amount, currency, type, asset, status, network, expected_recipient, expected_sender, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10)`,
        [intentId, user.sub, amountDec.toString(), ccy, type, ccy, network, recipient, senderAddress ?? null, idemKey ?? null],
      );
      const pay = await client.query(
        `INSERT INTO payments (payment_intent_id, user_id, amount, currency, type, status, provider)
         VALUES ($1,$2,$3,$4,$5,'pending',$6) RETURNING id`,
        [intentId, user.sub, amountDec.toString(), ccy, type, isCrypto ? 'solana-devnet' : 'mock-fiat'],
      );
      return { paymentDbId: pay.rows[0].id as string };
    });

    let data: any;
    if (isCrypto) {
      data = {
        id: intentId,
        paymentId: out.paymentDbId,
        amount: amountDec.toString(),
        currency: ccy,
        asset: ccy,
        type,
        status: 'pending',
        network: config.solanaNetwork,
        recipient,
        usdcMint: ccy === 'USDC' ? config.solanaUsdcMint : undefined,
        explorerHint: 'After signing, submit the signature to POST /api/v1/payments/:id/verify',
      };
    } else {
      // SIMULATED fiat: complete immediately through the mock provider with ledger entries.
      await withTx(async (client) => {
        await client.query(`UPDATE payment_intents SET status='completed', updated_at=now() WHERE id=$1`, [intentId]);
        await client.query(`UPDATE payments SET status='completed', updated_at=now() WHERE payment_intent_id=$1`, [intentId]);
        const bal = await ensureBalanceRow(client, user.sub, ccy);
        await commitLedger(
          client,
          { description: `Mock fiat deposit ${intentId}`, referenceType: 'payment', referenceId: intentId },
          [
            { accountType: 'user', accountRef: bal.balanceId, currency: ccy, credit: amountDec.toString() },
            { accountType: 'house', accountRef: `house:${ccy}`, currency: ccy, debit: amountDec.toString() },
          ],
        );
        await client.query(
          `INSERT INTO transactions (user_id, type, currency, amount, status, reference_type, reference_id)
           VALUES ($1,'deposit',$2,$3,'completed','payment_intent',$4)`,
          [user.sub, ccy, amountDec.toString(), intentId],
        );
      });
      data = { id: intentId, paymentId: out.paymentDbId, amount: amountDec.toString(), currency: ccy, type, status: 'completed', network, note: 'SIMULATED fiat payment (mock provider).' };
    }

    if (idemKey) await storeIdempotentResponse(user.sub, idemKey, data);
    return reply.code(201).send({ success: true, data });
  });

  // List the current user's payments (most recent first)
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub: string };
    const q = req.query as { limit?: string; status?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 200);
    const params: any[] = [user.sub];
    let statusFilter = '';
    if (q.status) {
      statusFilter = 'AND p.status = $2';
      params.push(q.status);
    }
    const r = await pool.query(
      `SELECT p.id, p.payment_intent_id AS "intentId", p.amount, p.currency, p.type, p.status,
              p.provider, p.created_at AS "createdAt", p.updated_at AS "updatedAt",
              bt.signature, bt.network
       FROM payments p LEFT JOIN blockchain_transactions bt ON bt.payment_id = p.id
       WHERE p.user_id = $1 ${statusFilter} ORDER BY p.created_at DESC LIMIT ${limit}`,
      params,
    );
    return reply.send({
      success: true,
      data: {
        payments: r.rows.map((row) => ({
          ...row,
          amount: String(row.amount),
          explorerUrl: row.signature
            ? `https://explorer.solana.com/tx/${row.signature}?cluster=devnet`
            : undefined,
        })),
      },
    });
  });

  // Get intent + instructions
  app.get('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub: string };
    const { id } = req.params as { id: string };
    const r = await pool.query(`SELECT * FROM payment_intents WHERE id = $1 AND user_id = $2`, [id, user.sub]);
    if (!r.rowCount) return reply.code(404).send({ success: false, error: { code: 'PAYMENT_NOT_FOUND', message: 'Payment could not be found.' } });
    const pi = r.rows[0];
    return reply.send({
      success: true,
      data: {
        id: pi.id, amount: String(pi.amount), currency: pi.currency, type: pi.type, status: pi.status,
        network: pi.network, recipient: pi.expected_recipient, asset: pi.asset,
        usdcMint: pi.asset === 'USDC' ? config.solanaUsdcMint : undefined,
        expiresAt: pi.expires_at,
      },
    });
  });

  // Verify crypto payment against REAL Solana devnet transaction
  app.post('/:id/verify', {
    onRequest: [app.authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { tags: ['payments'] },
  }, async (req, reply) => {
    const user = req.user as { sub: string };
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { signature?: string };
    const signature = String(body.signature ?? '').trim();
    if (!signature || signature.length < 32) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'A Solana transaction signature is required.' } });
    }

    const piR = await pool.query(`SELECT * FROM payment_intents WHERE id = $1`, [id]);
    if (!piR.rowCount) return reply.code(404).send({ success: false, error: { code: 'PAYMENT_NOT_FOUND', message: 'Payment could not be found.' } });
    const pi = piR.rows[0];
    if (pi.user_id !== user.sub) {
      return reply.code(403).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Payment belongs to another user.' } });
    }
    if (pi.type !== 'crypto') {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Only crypto payments are verified on-chain.' } });
    }
    if (pi.status === 'completed') {
      return reply.code(409).send({ success: false, error: { code: 'CONFLICT', message: 'Payment already completed.' } });
    }
    if (new Date(pi.expires_at).getTime() < Date.now()) {
      await pool.query(`UPDATE payment_intents SET status='expired' WHERE id=$1`, [id]);
      await pool.query(`UPDATE payments SET status='expired' WHERE payment_intent_id=$1`, [id]);
      return reply.code(410).send({ success: false, error: { code: 'PAYMENT_EXPIRED', message: 'Payment intent expired.' } });
    }

    // Signature replay guard
    const dup = await pool.query(`SELECT id, status FROM blockchain_transactions WHERE signature = $1`, [signature]);
    if (dup.rowCount) {
      return reply.code(409).send({ success: false, error: { code: 'SIGNATURE_REUSED', message: 'This transaction signature has already been processed.' } });
    }

    // ---- REAL devnet verification (chain = source of truth) ----
    let v: { fromAddress: string; toAddress: string; amount: string; asset: string; slot: number | null };
    try {
      const res = await verifyDevnetTransfer(signature, {
        recipient: pi.expected_recipient,
        amount: String(pi.amount),
        asset: pi.asset as 'SOL' | 'USDC',
        sender: pi.expected_sender ?? undefined,
      });
      v = res;
    } catch (e: any) {
      const code = e?.code === 'NOT_FOUND' ? 404 : 422;
      await pool.query(`UPDATE payments SET status='processing', updated_at=now() WHERE payment_intent_id=$1`, [id]);
      return reply.code(code).send({
        success: false,
        error: { code: 'VERIFICATION_FAILED', message: e?.message ?? 'On-chain verification failed.' },
      });
    }

    // Amount/asset/recipient already matched inside verifier; re-check defensively.
    if (v.toAddress !== pi.expected_recipient) {
      return reply.code(422).send({ success: false, error: { code: 'VERIFICATION_FAILED', message: 'Recipient mismatch.' } });
    }
    if (!new Decimal(v.amount).eq(new Decimal(String(pi.amount)))) {
      return reply.code(422).send({ success: false, error: { code: 'VERIFICATION_FAILED', message: `Amount mismatch: chain shows ${v.amount}, expected ${String(pi.amount)}.` } });
    }

    // Commit: store chain tx + complete payment + ledger + user tx history (atomic).
    const result = await withTx(async (client) => {
      const payR = await client.query(`SELECT id FROM payments WHERE payment_intent_id = $1`, [id]);
      const paymentDbId = payR.rows[0].id as string;
      // Re-check signature inside tx (race-safe).
      const again = await client.query(`SELECT id FROM blockchain_transactions WHERE signature = $1`, [signature]);
      if (again.rowCount) throw Object.assign(new Error('Signature already processed.'), { statusCode: 409 });
      // Re-check payment status inside tx.
      const st = await client.query(`SELECT status FROM payment_intents WHERE id = $1 FOR UPDATE`, [id]);
      if (st.rows[0].status === 'completed') throw Object.assign(new Error('Payment already completed.'), { statusCode: 409 });

      await client.query(
        `INSERT INTO blockchain_transactions (payment_id, signature, network, asset, from_address, to_address, amount, status, block, confirmed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8,now())`,
        [paymentDbId, signature, config.solanaNetwork, pi.asset, v.fromAddress, v.toAddress, v.amount, v.slot],
      );
      await client.query(`UPDATE payment_intents SET status='completed', updated_at=now() WHERE id=$1`, [id]);
      await client.query(`UPDATE payments SET status='completed', updated_at=now() WHERE payment_intent_id=$1`, [id]);
      const bal = await ensureBalanceRow(client, user.sub, pi.currency);
      await commitLedger(
        client,
        { description: `Solana devnet deposit ${id} (${v.asset})`, referenceType: 'payment', referenceId: id },
        [
          { accountType: 'user', accountRef: bal.balanceId, currency: pi.currency, credit: String(pi.amount) },
          { accountType: 'house', accountRef: `house:${pi.currency}`, currency: pi.currency, debit: String(pi.amount) },
        ],
      );
      await client.query(
        `INSERT INTO transactions (user_id, type, currency, amount, status, reference_type, reference_id)
         VALUES ($1,'deposit',$2,$3,'completed','payment_intent',$4)`,
        [user.sub, pi.currency, String(pi.amount), id],
      );
      return { paymentDbId };
    }).catch((e: any) => {
      if (e?.statusCode === 409) return { conflict: true as const, message: e.message };
      throw e;
    });

    if ((result as any).conflict) {
      return reply.code(409).send({ success: false, error: { code: 'SIGNATURE_REUSED', message: (result as any).message } });
    }

    // Best-effort webhook event record (idempotent on signature).
    await pool.query(
      `INSERT INTO webhook_events (event_id, event_type, payload, processed)
       VALUES ($1,'payment.completed',$2,true) ON CONFLICT (event_id) DO NOTHING`,
      [`solana:${signature}`, JSON.stringify({ paymentIntentId: id, signature })],
    );

    return reply.send({
      success: true,
      data: {
        id, status: 'completed', asset: v.asset, amount: v.amount,
        signature, explorerUrl: explorerTxUrl(signature),
      },
    });
  });

  // Solana balance passthrough (reads live devnet balance for an address)
  app.get('/solana/balance', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { address } = req.query as { address?: string };
    if (!address || !validateSolanaAddress(address)) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Valid Solana address required.' } });
    }
    const { getAccountBalanceSol } = await import('../solana/service.js');
    const balance = await getAccountBalanceSol(address);
    return reply.send({ success: true, data: { address, balance, network: config.solanaNetwork } });
  });
}
