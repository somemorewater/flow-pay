'use client';
import { useEffect, useState } from 'react';
import Field, { Status } from '@/components/ui/Field';
import { userMessage } from '@/lib/api/client';
import { getPayment, getPayments } from '@/lib/api/payments';
import { dateTime, money } from '@/lib/format';
import { useApp } from '@/lib/store';
import type { ApiPayment } from '@/types';

export default function Payments() {
  const { refresh } = useApp();
  const [payments, setPayments] = useState<ApiPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr('');
    try {
      setPayments(await getPayments());
    } catch (e) {
      setErr(userMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Status comes from the backend — poll it while a payment is incomplete.
  useEffect(() => {
    if (!selected) return;
    const t = setInterval(async () => {
      try {
        const pi = await getPayment(selected);
        setStatus(pi.status);
        if (['completed', 'failed', 'expired'].includes(pi.status)) {
          clearInterval(t);
          load();
          refresh();
        }
      } catch {
        // Keep last known status on transient errors.
      }
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <div className="narrow">
      <h1>Payments</h1>
      <p className="muted">Create deposits from the Wallet page, then track payment status here.</p>
      {loading && <p className="muted pad">Loading payments…</p>}
      {err && <div className="card stack"><p role="alert" className="error">{err}</p><button className="btn" onClick={load}>Retry</button></div>}
      {!loading && !err && payments.length === 0 && <div className="card"><p className="muted pad">No payments yet.</p></div>}
      {!loading && !err && payments.length > 0 && (
        <div className="card stack">
          {payments.map((p) => (
            <div className="kv" key={p.id}>
              <span>Amount</span><b>{money(p.amount, p.currency)} {p.currency}</b>
              <span>Type</span><b>{p.type} · {p.provider}</b>
              <span>Status</span><Status s={selected === p.intentId && status ? status : p.status} />
              <span>Created</span><b>{dateTime(p.createdAt)}</b>
              {p.explorerUrl && <><span>Transaction</span><a href={p.explorerUrl} target="_blank" rel="noreferrer">View on Solana Explorer</a></>}
              <button className="btn ghost" onClick={() => { setSelected(p.intentId); setStatus(p.status); }}>Track status</button>
            </div>
          ))}
        </div>
      )}
      <Field label="Track a payment"><input placeholder="Payment intent ID (pi_…)" value={selected ?? ''} onChange={(e) => setSelected(e.target.value || null)} /></Field>
      {selected && status && <p className="muted">Status: <Status s={status} /></p>}
    </div>
  );
}
