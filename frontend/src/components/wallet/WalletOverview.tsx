'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useApp, balanceOf } from '@/lib/store';
import { useAuth } from '@/lib/auth';
import { money } from '@/lib/format';
import Balances from './Balances';
import DepositModal from './DepositModal';
import TxTable from '@/components/transactions/TxTable';

export default function WalletOverview({ dashboard }: { dashboard?: boolean }) {
  const { wallet, txns, loading, error, refresh } = useApp();
  const { user } = useAuth();
  const [dep, setDep] = useState(false);
  const usd = balanceOf(wallet, 'USD');

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
