'use client';
import { useEffect, useState } from 'react';
import Field from '@/components/ui/Field';
import { userMessage } from '@/lib/api/client';
import { createExchangeQuote, executeExchange, getExchangeRates } from '@/lib/api/exchange';
import { money } from '@/lib/format';
import { parseAmount } from '@/lib/utils';
import { balanceOf, useApp } from '@/lib/store';
import { CURRENCIES } from '@/data/mock-data';
import type { Currency, ExchangeQuote } from '@/types';

export default function Exchange() {
  const { wallet, refresh } = useApp();
  const [from, setFrom] = useState<Currency>('NGN');
  const [to, setTo] = useState<Currency>('USD');
  const [amt, setAmt] = useState('100000');
  const [step, setStep] = useState<'form' | 'confirm' | 'done'>('form');
  const [quote, setQuote] = useState<ExchangeQuote | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [quoting, setQuoting] = useState(false);

  // Live quote from the backend (authoritative rate + fee).
  useEffect(() => {
    const n = parseAmount(amt);
    if (!n || from === to || step !== 'form') return;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        setQuote(await createExchangeQuote(from, to, String(n)));
      } catch {
        setQuote(null);
      } finally {
        setQuoting(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [amt, from, to, step]);

  function review() {
    const n = parseAmount(amt);
    if (!n) return setErr('Enter an amount greater than zero.');
    if (from === to) return setErr('Choose two different currencies.');
    if (n > balanceOf(wallet, from)) return setErr('Insufficient balance.');
    if (!quote) return setErr('No rate available for this pair yet. Try again.');
    setErr('');
    setStep('confirm');
  }

  async function confirm() {
    const n = parseAmount(amt);
    if (!n) return;
    setBusy(true);
    setErr('');
    try {
      const res = await executeExchange(from, to, String(n));
      setQuote({ ...res });
      await refresh();
      setStep('done');
    } catch (e) {
      setErr(userMessage(e));
      setStep('form');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <h1>Exchange</h1>
      <p className="muted">Rates are provided by the backend (mock rates, not live market data).</p>
      <div className="card stack">
        {step === 'form' && <>
          <Field label="You send" error={err}><div className="row gap"><input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /><select aria-label="From currency" value={from} onChange={(e) => setFrom(e.target.value as Currency)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div></Field>
          <div className="arrow" aria-hidden>↓</div>
          <Field label="You receive"><div className="row gap"><input readOnly value={quote ? Number(quote.receive).toLocaleString('en-US', { maximumFractionDigits: 6 }) : quoting ? 'Quoting…' : '—'} /><select aria-label="To currency" value={to} onChange={(e) => setTo(e.target.value as Currency)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div></Field>
          {quote && <div className="kv"><span>Exchange rate</span><b>1 {from} = {Number(quote.rate).toLocaleString('en-US', { maximumFractionDigits: 6 })} {to}</b><span>Platform fee</span><b>{money(quote.fee, to)}</b><span>You receive</span><b>{money(quote.receive, to)} {to}</b></div>}
          <button className="btn primary" onClick={review} disabled={quoting}>Review exchange</button>
          <RatesTable />
        </>}
        {step === 'confirm' && quote && <>
          <h2>Confirm exchange</h2>
          <div className="kv"><span>You send</span><b>{money(quote.amount, from)} {from}</b><span>You receive</span><b>{money(quote.receive, to)} {to}</b><span>Rate</span><b>{quote.rate}</b><span>Fee</span><b>{money(quote.fee, to)} {to}</b></div>
          {err && <p role="alert" className="error">{err}</p>}
          <button className="btn primary" onClick={confirm} disabled={busy}>{busy ? 'Processing…' : 'Confirm exchange'}</button>
          <button className="btn" onClick={() => setStep('form')} disabled={busy}>Back</button>
        </>}
        {step === 'done' && quote && <>
          <h2>Exchange completed</h2><p>You received <b>{money(quote.receive, to)} {to}</b>.</p>
          <button className="btn primary" onClick={() => setStep('form')}>New exchange</button>
        </>}
      </div>
    </div>
  );
}

function RatesTable() {
  const [rates, setRates] = useState<{ base: string; quote: string; rate: string }[] | null>(null);
  useEffect(() => {
    getExchangeRates().then(setRates).catch(() => setRates([]));
  }, []);
  if (!rates || rates.length === 0) return null;
  return (
    <div className="stack">
      <h2>Available rates</h2>
      <div className="kv">
        {rates.slice(0, 12).map((r) => [<span key={`${r.base}${r.quote}`}>{r.base} → {r.quote}</span>, <b key={`${r.base}${r.quote}v`}>{r.rate}</b>])}
      </div>
    </div>
  );
}
