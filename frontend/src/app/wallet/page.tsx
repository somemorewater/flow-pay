'use client';
import { useState } from 'react';
import Field from '@/components/ui/Field';
import WalletOverview from '@/components/wallet/WalletOverview';
import { userMessage } from '@/lib/api/client';
import { createWithdrawal } from '@/lib/api/withdrawals';
import { parseAmount } from '@/lib/utils';
import { balanceOf, useApp } from '@/lib/store';
import { CURRENCIES } from '@/data/mock-data';
import type { Currency } from '@/types';

export default function WalletPage() {
  const { wallet, refresh } = useApp();
  const [amount, setAmount] = useState('');
  const [cur, setCur] = useState<Currency>('USD');
  const [dest, setDest] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const isCrypto = cur === 'SOL' || cur === 'USDC';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = parseAmount(amount);
    if (!n) return setErr('Enter an amount greater than zero.');
    if (n > balanceOf(wallet, cur)) return setErr('Insufficient balance.');
    if (isCrypto && dest.trim().length < 32) return setErr('Enter a valid Solana destination address.');
    setErr('');
    setOk('');
    setBusy(true);
    try {
      const w = await createWithdrawal({
        amount: String(n),
        currency: cur,
        destination: isCrypto ? dest.trim() : undefined,
      });
      await refresh();
      setOk(isCrypto ? 'Withdrawal recorded (processing).' : 'Withdrawal completed (simulated fiat).');
      setAmount('');
      setDest('');
      void w;
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
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </Field>
          {isCrypto && (
            <Field label="Solana destination address">
              <input placeholder="Devnet address" value={dest} onChange={(e) => setDest(e.target.value)} />
            </Field>
          )}
          {ok && <p className="note ok" role="status">{ok}</p>}
          <button className="btn primary" disabled={busy}>{busy ? 'Processing…' : 'Withdraw'}</button>
        </form>
      </div>
    </>
  );
}
