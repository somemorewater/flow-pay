'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useApp, balanceOf } from '@/lib/store';
import { useAuth } from '@/lib/auth';
import { getExchangeRates } from '@/lib/api/exchange';
import { formatUnits, mulUnits, parseUnits } from '@/lib/decimal';
import { money } from '@/lib/format';
import Balances from './Balances';
import DepositModal from './DepositModal';
import TxTable from '@/components/transactions/TxTable';
import type { ExchangeRateRow } from '@/types';

const SCALE = 9;

/** Convert a balance to USD units (1e-9) using configured rates, or null if unconvertible. */
function toUsdUnits(balance: string, currency: string, rates: ExchangeRateRow[]): bigint | null {
  if (currency === 'USD') {
    try {
      return parseUnits(balance, SCALE);
    } catch {
      return null;
    }
  }
  const direct = rates.find((r) => r.base === currency && r.quote === 'USD');
  const inverse = rates.find((r) => r.base === 'USD' && r.quote === currency);
  try {
    const b = parseUnits(balance, SCALE);
    if (b === 0n) return 0n;
    if (direct) return mulUnits(b, parseUnits(direct.rate, SCALE), SCALE);
    if (inverse) {
      const r = parseUnits(inverse.rate, SCALE);
      if (r === 0n) return null;
      // usd = balance / rate
      return (b * 10n ** BigInt(SCALE)) / r;
    }
    return null;
  } catch {
    return null;
  }
}

export default function WalletOverview({ dashboard }: { dashboard?: boolean }) {
  const { wallet, txns, loading, error, refresh } = useApp();
  const { user } = useAuth();
  const [dep, setDep] = useState(false);
  const [rates, setRates] = useState<ExchangeRateRow[] | null>(null);
  const usd = balanceOf(wallet, 'USD');

  useEffect(() => {
    getExchangeRates().then(setRates).catch(() => setRates(null));
  }, []);

  const total = useMemo(() => {
    if (!wallet || !rates) return null;
    let sum = 0n;
    const excluded: string[] = [];
    for (const [currency, balance] of Object.entries(wallet.balances)) {
      let v: bigint | null = null;
      try {
        if (parseUnits(balance, SCALE) === 0n) continue;
        v = toUsdUnits(balance, currency, rates);
      } catch {
        v = null;
      }
      if (v == null) excluded.push(currency);
      else sum += v;
    }
    return { sum, excluded };
  }, [wallet, rates]);

  return (
    <>
      {dashboard ? <><h1>Good morning{user ? `, ${user.email}` : ''}</h1><p className="muted">Here&apos;s what&apos;s happening with your money today.</p></> : <h1>Wallet</h1>}
      {loading && !wallet && <p className="muted pad">Loading wallet…</p>}
      {error && <div className="card stack"><p role="alert" className="error">{error}</p><button className="btn" onClick={refresh}>Retry</button></div>}
      {(!loading || wallet) && !error && (
        <>
          <section className="card hero" aria-label="Total balance">
            <small className="muted">Total balance</small>
            <div className="big">{money(usd, 'USD')} <small>USD</small></div>
            {total && (
              <div className="muted">
                ≈ ${formatUnits(total.sum, SCALE, 2)} across currencies <small>(at configured rates)</small>
                {total.excluded.length > 0 && <small> · excludes: {total.excluded.join(', ')}</small>}
              </div>
            )}
            <small>Converted at FlowPay&apos;s configured rates — not live market prices.</small>
            <div className="row wrap gap">
              <button className="btn primary" onClick={() => setDep(true)}>Deposit</button>
              <Link className="btn" href="/wallet">Withdraw</Link><Link className="btn" href="/exchange">Exchange</Link>
              {dashboard && <Link className="btn" href="/payments">Pay</Link>}
            </div>
          </section>
          <Balances wallet={wallet} />
          <h2>{dashboard ? 'Recent transactions' : 'Wallet activity'}</h2>
          <div className="card flush"><TxTable txns={txns.slice(0, dashboard ? 6 : 10)} /></div>
        </>
      )}
      {dep && <DepositModal onClose={() => setDep(false)} />}
    </>
  );
}
