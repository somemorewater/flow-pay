'use client';
import { useState } from 'react';
import Field from '@/components/ui/Field';
import WalletOverview from '@/components/wallet/WalletOverview';
import SolanaBalance from '@/components/wallet/SolanaBalance';
import WithdrawalHistory from '@/components/wallet/WithdrawalHistory';
import LedgerView from '@/components/wallet/LedgerView';
import { userMessage } from '@/lib/api/client';
import { createWithdrawal } from '@/lib/api/withdrawals';
import { parseAmount } from '@/lib/utils';
import { balanceOf, useApp } from '@/lib/store';
import { FIAT_CURRENCIES } from '@/data/mock-data';
import type { Currency } from '@/types';

export default function WalletPage() {
  const { wallet, refresh } = useApp();
  const [amount, setAmount] = useState('');
  const [cur, setCur] = useState<Currency>('USD');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = parseAmount(amount);
    if (!n) return setErr('Enter an amount greater than zero.');
    if (n > balanceOf(wallet, cur)) return setErr('Insufficient balance.');
    setErr('');
    setOk('');
    setBusy(true);
    try {
      await createWithdrawal({ amount: String(n), currency: cur });
      await refresh();
      setHistoryVersion((v) => v + 1);
      setOk('Withdrawal completed (simulated fiat).');
      setAmount('');
    } catch (e) {
      setErr(userMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <WalletOverview />
      <h2>Withdraw</h2>
      <div className="card stack">
        <form className="stack" onSubmit={submit} noValidate>
          <Field label="Amount" error={err}>
            <div className="row gap">
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <select aria-label="Currency" value={cur} onChange={(e) => setCur(e.target.value as Currency)}>
                {FIAT_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </Field>
          <p className="muted">Fiat withdrawals only (simulated). Crypto withdrawals are not currently supported — on-chain payouts are not implemented.</p>
          {ok && <p className="note ok" role="status">{ok}</p>}
          <button className="btn primary" disabled={busy}>{busy ? 'Processing…' : 'Withdraw'}</button>
        </form>
      </div>
      <h2>Withdrawal history</h2>
      <WithdrawalHistory version={historyVersion} />
      <h2>Phantom balance</h2>
      <SolanaBalance />
      <h2>Ledger</h2>
      <LedgerView />
    </>
  );
}
