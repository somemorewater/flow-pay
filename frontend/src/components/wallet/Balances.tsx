import { CURRENCIES } from '@/data/mock-data';
import { money } from '@/lib/format';
import type { WalletView } from '@/types';

export default function Balances({ wallet }: { wallet: WalletView | null }) {
  if (!wallet) return <div className="grid3"><div className="card"><small className="muted">Wallet</small><div className="amt muted">Loading…</div></div></div>;
  return <div className="grid3">{CURRENCIES.map((c) => <div className="card" key={c}><small className="muted">{c}</small><div className="amt">{money(wallet.balances[c] ?? '0', c)}</div></div>)}</div>;
}
