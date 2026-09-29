// Deposit: fiat intents complete via the backend mock-fiat provider;
// SOL/USDC intents are paid with Phantom on Solana Devnet and only count
// once the backend verifies the transaction on-chain.
'use client';
import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Field from '@/components/ui/Field';
import { userMessage } from '@/lib/api/client';
import { createPaymentIntent, explorerTxUrl, verifyPayment } from '@/lib/api/payments';
import {
  connectPhantom,
  disconnectPhantom,
  isPhantomAvailable,
  shortenAddress,
  signAndSendSolTransfer,
  signAndSendUsdcTransfer,
} from '@/lib/api/solana';
import { money } from '@/lib/format';
import { parseAmount } from '@/lib/utils';
import { useApp } from '@/lib/store';
import { CRYPTO_ASSETS, FIAT_CURRENCIES } from '@/data/mock-data';
import type { Currency, PaymentIntent } from '@/types';

type Phase = 'form' | 'created' | 'signing' | 'verifying' | 'done';

export default function DepositModal({ onClose }: { onClose: () => void }) {
  const { refresh } = useApp();
  const [kind, setKind] = useState<'fiat' | 'crypto'>('fiat');
  const [amount, setAmount] = useState('100.00');
  const [cur, setCur] = useState<Currency>('USD');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>('form');
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [phantom, setPhantom] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const pick = (k: 'fiat' | 'crypto') => {
    setKind(k);
    setCur(k === 'fiat' ? 'USD' : 'SOL');
    setErr('');
  };

  async function connect() {
    setErr('');
    try {
      setPhantom(await connectPhantom());
    } catch (e) {
      setErr(userMessage(e));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = parseAmount(amount);
    if (!n) return setErr('Enter an amount greater than zero.');
    setErr('');
    setBusy(true);
    try {
      const pi = await createPaymentIntent({
        amount: String(n),
        currency: cur,
        type: kind,
        senderAddress: kind === 'crypto' && phantom ? phantom : undefined,
      });
      setIntent(pi);
      setPhase('created');
      if (kind === 'fiat') {
        // Backend mock-fiat provider completes immediately with ledger entries.
        await refresh();
        setPhase('done');
      }
    } catch (e) {
      setErr(userMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function payWithPhantom() {
    if (!intent?.recipient) return;
    setErr('');
    setBusy(true);
    setPhase('signing');
    try {
      // Amount/recipient/network come from the backend intent — never hardcoded.
      const sig =
        intent.asset === 'USDC'
          ? await signAndSendUsdcTransfer(intent.recipient, intent.amount, intent.usdcMint ?? '')
          : await signAndSendSolTransfer(intent.recipient, intent.amount);
      setSignature(sig);
      setPhase('verifying');
      // Backend independently verifies the tx on Solana Devnet before crediting.
      await verifyPayment(intent.id, sig);
      await refresh();
      setPhase('done');
    } catch (e) {
      setErr(userMessage(e));
      setPhase('created');
    } finally {
      setBusy(false);
    }
  }

  const isFiatDone = phase === 'done' && kind === 'fiat';
  const isCryptoDone = phase === 'done' && kind === 'crypto';

  return (
    <Modal title="Deposit money" onClose={onClose}>
      {phase === 'form' && (
        <form onSubmit={submit} noValidate className="stack">
          <div className="seg" role="group" aria-label="Payment type">
            {(['fiat', 'crypto'] as const).map((k) => <button type="button" key={k} aria-pressed={kind === k} className={kind === k ? 'on' : ''} onClick={() => pick(k)}>{k === 'fiat' ? 'Fiat' : 'Crypto (Solana)'}</button>)}
          </div>
          <Field label="Amount" error={err}><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label={kind === 'fiat' ? 'Currency' : 'Asset'}>
            <select value={cur} onChange={(e) => setCur(e.target.value as Currency)}>{(kind === 'fiat' ? FIAT_CURRENCIES : CRYPTO_ASSETS).map((c) => <option key={c}>{c}</option>)}</select>
          </Field>
          {kind === 'fiat' ? (
            <Field label="Payment method"><select><option>Card (simulated provider)</option></select></Field>
          ) : (
            <div className="note stack">
              <b>Pay with Phantom on Solana Devnet</b>
              {isPhantomAvailable() ? (
                phantom ? (
                  <div className="kv"><span>Connected</span><b className="mono">{shortenAddress(phantom)}</b></div>
                ) : (
                  <button type="button" className="btn" onClick={connect}>Connect Phantom</button>
                )
              ) : (
                <small>Phantom wallet not detected. Install Phantom to deposit SOL/USDC.</small>
              )}
              {phantom && <button type="button" className="btn ghost" onClick={() => { disconnectPhantom(); setPhantom(null); }}>Disconnect</button>}
              <small>You will sign the exact backend-quoted amount. Funds are credited only after backend on-chain verification.</small>
            </div>
          )}
          <button className="btn primary" disabled={busy}>{busy ? 'Creating payment…' : 'Continue'}</button>
        </form>
      )}

      {(phase === 'created' || phase === 'signing' || phase === 'verifying') && intent && (
        <div className="stack">
          <h3>{phase === 'verifying' ? 'Verifying transaction…' : phase === 'signing' ? 'Confirming Solana transaction…' : 'Payment created'}</h3>
          <div className="kv">
            <span>Amount</span><b>{money(intent.amount, intent.currency)} {intent.currency}</b>
            <span>Payment ID</span><b className="mono">{intent.id}</b>
            <span>Network</span><b>{intent.network}</b>
            {intent.recipient && <><span>Recipient</span><b className="mono">{shortenAddress(intent.recipient)}</b></>}
            <span>Status</span><b>{phase === 'created' ? 'Pending' : 'Processing…'}</b>
          </div>
          {err && <p role="alert" className="error">{err}</p>}
          {kind === 'crypto' && (
            <button className="btn primary" onClick={payWithPhantom} disabled={busy || !phantom}>
              {!phantom ? 'Connect Phantom to pay' : busy ? 'Processing…' : `Pay ${money(intent.amount, intent.currency)} with Phantom`}
            </button>
          )}
        </div>
      )}

      {isFiatDone && intent && (
        <div className="stack">
          <h3>Payment completed</h3>
          <div className="kv"><span>Amount</span><b>{money(intent.amount, intent.currency)} {intent.currency}</b><span>Payment ID</span><b className="mono">{intent.id}</b><span>Status</span><b>Completed (simulated fiat provider)</b></div>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      )}

      {isCryptoDone && intent && signature && (
        <div className="stack">
          <h3>Payment completed</h3>
          <div className="kv">
            <span>Amount</span><b>{money(intent.amount, intent.currency)} {intent.currency}</b>
            <span>Network</span><b>Solana Devnet</b>
            <span>Transaction</span><b className="mono">{shortenAddress(signature)}</b>
          </div>
          <a className="btn" href={explorerTxUrl(signature)} target="_blank" rel="noreferrer">View on Solana Explorer</a>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      )}
    </Modal>
  );
}
