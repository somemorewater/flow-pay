'use client';
import { useEffect, useRef, useState } from 'react';
import Field, { Status } from '@/components/ui/Field';
import Modal from '@/components/ui/Modal';
import { userMessage } from '@/lib/api/client';
import { getPayment, getPayments } from '@/lib/api/payments';
import { isTerminal, pollUntil } from '@/lib/api/poll';
import { shortenAddress } from '@/lib/api/solana';
import { dateTime, money } from '@/lib/format';
import { useApp } from '@/lib/store';
import type { ApiPayment, PaymentIntent } from '@/types';

export default function Payments() {
  const { refresh } = useApp();
  const [payments, setPayments] = useState<ApiPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [detail, setDetail] = useState<PaymentIntent | null>(null);
  const [detailErr, setDetailErr] = useState('');
  const abortRef = useRef<AbortController | null>(null);

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
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Status comes from the backend — poll it while a payment is incomplete.
  // Single loop via the shared pollUntil utility; aborted on unmount or reselect.
  useEffect(() => {
    abortRef.current?.abort();
    if (!selected) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    pollUntil({
      fetchStatus: () => getPayment(selected),
      getStatus: (pi) => pi.status,
      intervalMs: 4000,
      signal: ctrl.signal,
      onUpdate: (pi) => setStatus(pi.status),
    }).then(() => {
      load();
      refresh();
    }).catch(() => {
      // Timeout/abort/transient errors: keep last known status.
    });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  async function openDetail(intentId: string) {
    setDetailErr('');
    try {
      setDetail(await getPayment(intentId));
    } catch (e) {
      setDetailErr(userMessage(e));
    }
  }

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
              <span>Type</span><b>{p.type} · {p.provider === 'mock-fiat' ? 'Simulated fiat' : p.provider}</b>
              <span>Status</span><Status s={selected === p.intentId && status ? status : p.status} />
              <span>Created</span><b>{dateTime(p.createdAt)}</b>
              {p.explorerUrl && <><span>Transaction</span><a href={p.explorerUrl} target="_blank" rel="noreferrer">View on Solana Explorer</a></>}
              <span>Details</span><span><button className="btn ghost" onClick={() => openDetail(p.intentId)}>View</button>{' '}<button className="btn ghost" onClick={() => { setSelected(p.intentId); setStatus(p.status); }}>Track status</button></span>
            </div>
          ))}
        </div>
      )}
      {detailErr && <p role="alert" className="error">{detailErr}</p>}
      <Field label="Track a payment"><input placeholder="Payment intent ID (pi_…)" value={selected ?? ''} onChange={(e) => setSelected(e.target.value || null)} /></Field>
      {selected && status && !isTerminal(status) && <p className="muted">Tracking… Status: <Status s={status} /></p>}
      {selected && status && isTerminal(status) && <p className="muted">Status: <Status s={status} /></p>}
      {detail && (
        <Modal title="Payment details" onClose={() => setDetail(null)}>
          <div className="kv">
            <span>Payment ID</span><b className="mono">{detail.id}</b>
            <span>Amount</span><b>{money(detail.amount, detail.currency)} {detail.currency}</b>
            {detail.asset && <><span>Asset</span><b>{detail.asset}</b></>}
            <span>Type</span><b>{detail.type}</b>
            <span>Status</span><Status s={detail.status} />
            <span>Network</span><b>{detail.network}</b>
            {detail.recipient && <><span>Recipient</span><b className="mono">{shortenAddress(detail.recipient)}</b></>}
            {detail.type === 'fiat' && <><span>Provider</span><b>Simulated fiat — no real money moved</b></>}
          </div>
        </Modal>
      )}
    </div>
  );
}
