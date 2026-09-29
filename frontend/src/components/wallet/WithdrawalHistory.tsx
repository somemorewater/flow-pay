'use client';
import { useEffect, useState } from 'react';
import { Status } from '@/components/ui/Field';
import { userMessage } from '@/lib/api/client';
import { getWithdrawals } from '@/lib/api/withdrawals';
import { dateTime, money } from '@/lib/format';
import type { Withdrawal } from '@/types';

/** Withdrawal history. Fiat rows are simulated; crypto withdrawals are disabled. */
export default function WithdrawalHistory({ version }: { version: number }) {
  const [rows, setRows] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  async function load() {
    setLoading(true);
    setErr('');
    try {
      setRows(await getWithdrawals());
    } catch (e) {
      setErr(userMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  if (loading) return <p className="muted pad">Loading withdrawals…</p>;
  if (err) return <div className="card stack"><p role="alert" className="error">{err}</p><button className="btn" onClick={load}>Retry</button></div>;
  if (rows.length === 0) return <div className="card"><p className="muted pad">No withdrawals yet.</p></div>;

  return (
    <div className="card flush">
      <table className="tx desk-only">
        <thead><tr><th>Amount</th><th>Currency</th><th>Provider</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>{rows.map((w) => (
          <tr key={w.id}>
            <td className="num">{money(w.amount, w.currency, true)}</td>
            <td>{w.currency}</td>
            <td className="muted">{w.network === 'mock-fiat' ? 'Simulated fiat' : w.network}</td>
            <td><Status s={w.status} /></td>
            <td className="muted">{dateTime(w.created_at)}</td>
          </tr>))}</tbody>
      </table>
      <ul className="cards mob-only">{rows.map((w) => (
        <li key={w.id}>
          <span className="grow"><b>{money(w.amount, w.currency, true)} {w.currency}</b><small className="muted">{w.network === 'mock-fiat' ? 'Simulated fiat' : w.network} · {dateTime(w.created_at)}</small></span>
          <span className="right"><Status s={w.status} /></span>
        </li>))}</ul>
    </div>
  );
}
