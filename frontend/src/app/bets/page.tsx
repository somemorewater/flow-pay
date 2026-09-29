'use client';
import { useEffect, useState } from 'react';
import Field, { Status } from '@/components/ui/Field';
import { userMessage } from '@/lib/api/client';
import { createBet, getBet, getBets, settleBet } from '@/lib/api/bets';
import { isTerminal } from '@/lib/api/poll';
import { dateTime, money } from '@/lib/format';
import { parseAmount } from '@/lib/utils';
import { useApp } from '@/lib/store';
import type { Bet } from '@/types';

const BET_CURRENCIES = ['USD', 'NGN', 'EUR', 'GBP'];

export default function Bets() {
  const { refresh } = useApp();
  const [stake, setStake] = useState('10');
  const [currency, setCurrency] = useState('USD');
  const [odds, setOdds] = useState('2.50');
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [settling, setSettling] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setBets(await getBets());
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

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const s = parseAmount(stake);
    const o = parseAmount(odds);
    if (!s) return setErr('Enter a stake greater than zero.');
    if (!o || o <= 1) return setErr('Odds must be greater than 1.');
    setBusy(true);
    setErr('');
    try {
      // Amounts are decimal strings end-to-end (no float math).
      await createBet(String(s), currency, String(o));
      await Promise.all([load(), refresh()]);
    } catch (e) {
      setErr(userMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function settle(id: string) {
    setSettling(id);
    setErr('');
    try {
      await settleBet(id);
      // Poll the backend until the Rust worker settles the bet.
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 120000);
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (ctrl.signal.aborted) throw new Error('Timed out waiting for settlement.');
          await new Promise((r) => setTimeout(r, 3000));
          const b = await getBet(id);
          setBets((prev) => prev.map((x) => (x.id === id ? b : x)));
          if (isTerminal(b.status)) break;
        }
      } finally {
        clearTimeout(t);
      }
      await Promise.all([load(), refresh()]);
    } catch (e) {
      setErr(userMessage(e));
    } finally {
      setSettling(null);
    }
  }

  const s = parseAmount(stake);
  const o = parseAmount(odds);

  return (
    <div className="narrow">
      <h1>Bet settlements</h1>
      <p className="muted">Bets settle asynchronously via the Rust settlement worker.</p>
      <div className="card stack">
        <form className="stack" onSubmit={create} noValidate>
          <Field label="Stake" error={err}><input inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} /></Field>
          <Field label="Currency"><select value={currency} onChange={(e) => setCurrency(e.target.value)}>{BET_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Odds"><input inputMode="decimal" value={odds} onChange={(e) => setOdds(e.target.value)} /></Field>
          <div className="kv"><span>Potential payout</span><b>{money((s ?? 0) * (o ?? 0), currency)}</b></div>
          <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create bet'}</button>
        </form>
      </div>
      <h2>Your bets</h2>
      {loading && <p className="muted pad">Loading bets…</p>}
      {!loading && bets.length === 0 && <div className="card"><p className="muted pad">No bets yet.</p></div>}
      {bets.map((b) => (
        <div className="card stack" key={b.id}>
          <div className="kv">
            <span>Bet</span><b className="mono">{b.id.slice(0, 8)}…</b>
            <span>Stake</span><b>{money(b.stake, b.currency)} {b.currency}</b>
            <span>Odds</span><b>{Number(b.odds).toFixed(2)}</b>
            <span>Status</span><Status s={b.status} />
            {b.payout != null && <><span>Payout</span><b className="pos">{money(b.payout, b.currency, true)}</b></>}
            <span>Created</span><b>{dateTime(b.created_at)}</b>
          </div>
          {b.status === 'pending' && (
            <button className="btn primary" disabled={settling === b.id} onClick={() => settle(b.id)}>
              {settling === b.id ? 'Settling…' : 'Settle bet'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
