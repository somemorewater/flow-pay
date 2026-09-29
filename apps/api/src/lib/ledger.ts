import Decimal from 'decimal.js';
import type { PoolClient } from 'pg';

export interface LedgerLine {
  accountType: 'user' | 'house' | 'escrow' | 'fee';
  /** wallet_balance id for user accounts, or a label like "house:USD" / "escrow:USD" */
  accountRef: string;
  currency: string;
  debit?: string;
  credit?: string;
}

function dec(v: string | number | undefined): Decimal {
  if (v === undefined || v === '') return new Decimal(0);
  const d = new Decimal(v);
  if (!d.isFinite()) throw new Error(`Invalid monetary value: ${v}`);
  if (d.isNegative()) throw new Error(`Negative monetary value not allowed: ${v}`);
  return d;
}

/**
 * Reusable double-entry ledger writer.
 * Every call runs inside the caller's Postgres transaction and:
 *  1. validates total debits === total credits (per currency),
 *  2. inserts ledger_transactions + ledger_entries,
 *  3. applies net balance changes to user wallet_balances rows.
 */
export async function commitLedger(
  client: PoolClient,
  opts: { description: string; referenceType?: string; referenceId?: string },
  lines: LedgerLine[],
): Promise<string> {
  if (lines.length < 2) throw new Error('Ledger transaction requires at least 2 lines');

  // Validate no line has both debit and credit, and group totals per currency.
  const totals = new Map<string, { d: Decimal; c: Decimal }>();
  for (const l of lines) {
    const d = dec(l.debit);
    const c = dec(l.credit);
    if (d.gt(0) && c.gt(0)) throw new Error('Ledger line cannot have both debit and credit');
    if (d.eq(0) && c.eq(0)) throw new Error('Ledger line must have a debit or credit');
    if (!l.currency) throw new Error('Ledger line missing currency');
    const t = totals.get(l.currency) ?? { d: new Decimal(0), c: new Decimal(0) };
    t.d = t.d.plus(d);
    t.c = t.c.plus(c);
    totals.set(l.currency, t);
  }
  for (const [ccy, t] of totals) {
    if (!t.d.eq(t.c)) {
      throw new Error(`Unbalanced ledger for ${ccy}: debits ${t.d.toString()} != credits ${t.c.toString()}`);
    }
  }

  const lt = await client.query(
    `INSERT INTO ledger_transactions (description, reference_type, reference_id) VALUES ($1,$2,$3) RETURNING id`,
    [opts.description, opts.referenceType ?? null, opts.referenceId ?? null],
  );
  const ledgerId: string = lt.rows[0].id;

  for (const l of lines) {
    const d = dec(l.debit);
    const c = dec(l.credit);
    await client.query(
      `INSERT INTO ledger_entries (ledger_transaction_id, account_type, account_ref, currency, debit, credit)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [ledgerId, l.accountType, l.accountRef, l.currency, d.toString(), c.toString()],
    );
    // Apply to user wallet balance cache (source of truth remains the ledger rows).
    if (l.accountType === 'user') {
      // accountRef is the wallet_balances.id
      const net = c.minus(d); // credit increases user balance
      const upd = await client.query(
        `UPDATE wallet_balances SET balance = balance + $2::numeric, updated_at = now()
         WHERE id = $1 RETURNING balance`,
        [l.accountRef, net.toString()],
      );
      if (upd.rowCount === 0) throw new Error(`Wallet balance not found: ${l.accountRef}`);
      if (new Decimal(upd.rows[0].balance).isNegative()) {
        throw new Error('Insufficient funds (ledger would go negative)');
      }
    }
  }
  return ledgerId;
}
