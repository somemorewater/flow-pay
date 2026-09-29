'use client';
import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { Status } from '@/components/ui/Field';
import TxTable from '@/components/transactions/TxTable';
import { userMessage } from '@/lib/api/client';
import { getPayments } from '@/lib/api/payments';
import { getTransactions } from '@/lib/api/transactions';
import { dateTime, money } from '@/lib/format';
import type { ApiPayment, ApiTransaction } from '@/types';

const TABS: [string, string][] = [['all', 'All'], ['deposit', 'Deposits'], ['withdrawal', 'Withdrawals'], ['payment', 'Payments'], ['bet', 'Bets'], ['settlement', 'Settlements'], ['exchange', 'Exchange']];

const TYPE_HELP: Record<string, string> = {
  deposit: 'Money in — fiat deposits are simulated, crypto deposits are verified on Solana Devnet.',
  withdrawal: 'Money out — fiat withdrawals are simulated.',
  payment: 'Payment instruction.',
  bet: 'Bet stake locked in escrow.',
  settlement: 'Bet outcome settled by the Rust settlement worker.',
  exchange: 'Currency conversion at configured rates.',
};

export default function Transactions() {
  const [tab, setTab] = useState('all');
  const [cur, setCur] = useState('');
  const [st, setSt] = useState('');
  const [txns, setTxns] = useState<ApiTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<ApiTransaction | null>(null);
  const [linked, setLinked] = useState<ApiPayment | null>(null);

  async function load() {
    setLoading(true);
    setErr('');
    try {
      setTxns(await getTransactions({
        type: tab === 'all' ? undefined : tab,
        currency: cur || undefined,
        status: st || undefined,
        limit: 100,
      }));
    } catch (e) {
      setErr(userMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, cur, st]);

  // When a deposit links to a payment intent, pull the payment for its
  // backend status and Devnet Explorer link.
  useEffect(() => {
    setLinked(null);
    if (sel?.reference_type !== 'payment_intent' || !sel.reference_id) return;
    const ref = sel.reference_id;
    getPayments(100).then((list) => {
      const found = list.find((p) => p.intentId === ref) ?? null;
      setLinked(found);
    }).catch(() => setLinked(null));
  }, [sel]);

  return (
    <>
      <h1>Transactions</h1><p className="muted">Complete history of wallet and payment activity.</p>
      <div className="row wrap gap" role="group" aria-label="Filter by type">{TABS.map(([k, l]) => <button key={k} className={`chip ${tab === k ? 'on' : ''}`} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
      <div className="row wrap gap">
        <select aria-label="Currency" value={cur} onChange={(e) => setCur(e.target.value)}><option value="">Currency</option><option>USD</option><option>NGN</option><option>EUR</option><option>GBP</option><option>SOL</option><option>USDC</option></select>
        <select aria-label="Status" value={st} onChange={(e) => setSt(e.target.value)}><option value="">Status</option><option value="completed">Completed</option><option value="pending">Pending</option><option value="processing">Processing</option><option value="failed">Failed</option><option value="expired">Expired</option></select>
      </div>
      {loading && <p className="muted pad">Loading transactions…</p>}
      {err && <div className="card stack"><p role="alert" className="error">{err}</p><button className="btn" onClick={load}>Retry</button></div>}
      {!loading && !err && <div className="card flush"><TxTable txns={txns} showId onSelect={setSel} /></div>}
      {sel && <Modal title="Transaction details" onClose={() => setSel(null)}>
        <div className="kv"><span>Transaction ID</span><b className="mono">{sel.id}</b><span>Type</span><b>{sel.type}</b><span>Amount</span><b>{money(sel.amount, sel.currency)} {sel.currency}</b><span>Status</span><Status s={sel.status} /><span>Created</span><b>{dateTime(sel.created_at)}</b><span>Reference</span><b>{sel.reference_type ?? '—'}{sel.reference_id ? ` · ${sel.reference_id}` : ''}</b>
          {TYPE_HELP[sel.type] && <><span>About</span><b>{TYPE_HELP[sel.type]}</b></>}
          {linked && <><span>Payment status</span><Status s={linked.status} /></>}
          {linked?.explorerUrl && <><span>Blockchain</span><a href={linked.explorerUrl} target="_blank" rel="noreferrer">View on Solana Explorer</a></>}</div>
      </Modal>}
    </>
  );
}
