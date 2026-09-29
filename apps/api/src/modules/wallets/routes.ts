import type { FastifyInstance } from 'fastify';
import { pool } from '../../lib/db.js';
import { getWalletView } from '../../lib/wallets.js';

export async function walletRoutes(app: FastifyInstance) {
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub: string };
    const view = await getWalletView(user.sub);
    return reply.send({ success: true, data: { wallet: view } });
  });

  app.get('/ledger', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub: string };
    const { currency } = req.query as { currency?: string };
    const params: any[] = [user.sub];
    let filter = '';
    if (currency) {
      filter = 'AND e.currency = $2';
      params.push(currency);
    }
    // Resolve user's balance ids to scope ledger entries to this user.
    const balances = await pool.query(
      `SELECT wb.id FROM wallet_balances wb JOIN wallets w ON w.id = wb.wallet_id WHERE w.user_id = $1`,
      [user.sub],
    );
    const ids = balances.rows.map((r) => r.id);
    if (ids.length === 0) return reply.send({ success: true, data: { entries: [] } });
    const r = await pool.query(
      `SELECT e.*, lt.description, lt.reference_type, lt.reference_id, lt.created_at AS tx_created_at
       FROM ledger_entries e JOIN ledger_transactions lt ON lt.id = e.ledger_transaction_id
       WHERE e.account_ref = ANY($1) ${filter} ORDER BY e.created_at DESC LIMIT 100`,
      ids.length && currency ? [ids, currency] : [ids],
    );
    return reply.send({ success: true, data: { entries: r.rows } });
  });
}
