'use client';
import { useEffect, useState } from 'react';
import { userMessage } from '@/lib/api/client';
import { getWalletLedger } from '@/lib/api/wallet';
import { dateTime, money } from '@/lib/format';
import { CURRENCIES } from '@/data/mock-data';
import type { LedgerEntry } from '@/types';

/** Double-entry ledger lines for the user's own balance accounts. */
export default function LedgerView() {
  const [cur, setCur] = useState('');
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  async function load(currency: string) {
    setLoading(true);
    setErr('');
    try {
      setEntries(await getWalletLedger(currency || undefined));
    } catch (e) {
      setErr(userMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(cur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur]);

  return (
    <div className="stack">
      <div className="row wrap gap">
        <select aria-label="Ledger currency" value={cur} onChange={(e) => setCur(e.target.value)}>
          <option value="">All currencies</option>
          {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      {loading && <p className="muted pad">Loading ledger…</p>}
      {err && <div className="card stack"><p role="alert" className="error">{err}</p><button className="btn" onClick={() => load(cur)}>Retry</button></div>}
      {!loading && !err && entries.length === 0 && <div className="card"><p className="muted pad">No ledger entries yet.</p></div>}
      {!loading && !err && entries.length > 0 && (
        <div className="card flush">
          <table className="tx desk-only">
            <thead><tr><th>Description</th><th>Currency</th><th>Debit</th><th>Credit</th><th>Date</th></tr></thead>
            <tbody>{entries.map((e) => (
              <tr key={e.id}>
                <td>{e.description}{e.reference_id && <small className="muted"> · <span className="mono">{e.reference_id.slice(0, 8)}…</span></small>}</td>
                <td>{e.currency}</td>
                <td className="num">{Number(e.debit) > 0 ? money(e.debit, e.currency) : '—'}</td>
                <td className="num pos">{Number(e.credit) > 0 ? money(e.credit, e.currency) : '—'}</td>
                <td className="muted">{dateTime(e.created_at)}</td>
              </tr>))}</tbody>
          </table>
          <ul className="cards mob-only">{entries.map((e) => {
            const isCredit = Number(e.credit) > 0;
            return (
              <li key={e.id}>
                <span className="grow"><b>{e.description}</b><small className="muted">{e.currency} · {isCredit ? 'Credit' : 'Debit'} · {dateTime(e.created_at)}</small></span>
                <span className="right"><b className={isCredit ? 'pos' : ''}>{money(isCredit ? e.credit : e.debit, e.currency, true)}</b></span>
              </li>
            );
          })}</ul>
        </div>
      )}
    </div>
  );
}
