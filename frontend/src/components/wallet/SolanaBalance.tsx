'use client';
import { useState } from 'react';
import { userMessage } from '@/lib/api/client';
import { getSolanaBalance } from '@/lib/api/payments';
import { connectPhantom, disconnectPhantom, isPhantomAvailable, shortenAddress } from '@/lib/api/solana';
import { money } from '@/lib/format';

/**
 * External Phantom wallet balance on Solana Devnet.
 * This is NOT the FlowPay internal balance — it only shows what the
 * connected external wallet holds, for funding deposits.
 */
export default function SolanaBalance() {
  const [addr, setAddr] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function load(address: string) {
    setLoading(true);
    setErr('');
    try {
      const res = await getSolanaBalance(address);
      setBalance(res.balance);
    } catch (e) {
      setErr(userMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function connect() {
    setErr('');
    try {
      const a = await connectPhantom();
      setAddr(a);
      await load(a);
    } catch (e) {
      setErr(userMessage(e));
    }
  }

  function disconnect() {
    disconnectPhantom();
    setAddr(null);
    setBalance(null);
  }

  return (
    <div className="card stack">
      <div className="row between">
        <b>Phantom wallet <span className="muted">(Devnet, external)</span></b>
        {addr && <button className="btn ghost" onClick={disconnect}>Disconnect</button>}
      </div>
      {!addr && (
        <>
          {isPhantomAvailable()
            ? <button className="btn" onClick={connect}>Connect Phantom to view balance</button>
            : <p className="muted">Phantom wallet not detected. Install Phantom to view a Devnet balance.</p>}
        </>
      )}
      {addr && (
        <div className="kv">
          <span>Address</span><b className="mono">{shortenAddress(addr)}</b>
          <span>Devnet SOL</span><b>{loading ? 'Loading…' : balance != null ? money(balance, 'SOL') : '—'}</b>
        </div>
      )}
      {addr && !loading && <button className="btn" onClick={() => load(addr)}>Refresh balance</button>}
      {err && <p role="alert" className="error">{err}</p>}
      <small>External wallet funds live outside FlowPay. Only what you deposit through a verified payment becomes your FlowPay balance.</small>
    </div>
  );
}
