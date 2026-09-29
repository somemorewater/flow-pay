import type { ApiTransaction } from '@/types';
import { dateTime, money } from '@/lib/format';
import { Status } from '@/components/ui/Field';

const ICON: Record<string, string> = { deposit: '↓', withdrawal: '↑', payment: '▣', bet: '◇', settlement: '✓', exchange: '⇄' };

// Backend stores all amounts >= 0; outflows (bet stake, withdrawal) display negative.
function signedAmount(t: ApiTransaction): number {
  const v = Number(t.amount);
  if (!isFinite(v)) return 0;
  return t.type === 'bet' || t.type === 'withdrawal' ? -Math.abs(v) : Math.abs(v);
}

function describe(t: ApiTransaction): string {
  switch (t.type) {
    case 'deposit':
      return 'Deposit';
    case 'withdrawal':
      return 'Withdrawal';
    case 'payment':
      return 'Payment';
    case 'bet':
      return 'Bet stake';
    case 'settlement':
      return 'Bet settlement';
    case 'exchange':
      return 'Exchange';
    default:
      return t.type;
  }
}

export default function TxTable({ txns, onSelect, showId }: { txns: ApiTransaction[]; onSelect?: (t: ApiTransaction) => void; showId?: boolean }) {
  if (!txns.length) return <p className="muted pad">No transactions found.</p>;
  const open = (t: ApiTransaction) => onSelect?.(t);
  return (
    <>
      <table className="tx desk-only"><thead><tr>{showId && <th>Transaction ID</th>}<th>Type</th><th>Description</th><th>Amount</th><th>Currency</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>{txns.map((t) => (
          <tr key={t.id} tabIndex={onSelect ? 0 : undefined} onClick={() => open(t)} onKeyDown={(e) => e.key === 'Enter' && open(t)} className={onSelect ? 'click' : ''}>
            {showId && <td className="mono">{t.id}</td>}
            <td><span className="ico" aria-hidden>{ICON[t.type] ?? '•'}</span> {t.type[0].toUpperCase() + t.type.slice(1)}</td><td>{describe(t)}</td>
            <td className={`num ${signedAmount(t) > 0 ? 'pos' : ''}`}>{money(signedAmount(t), t.currency, true)}</td><td>{t.currency}</td><td><Status s={t.status} /></td><td className="muted">{dateTime(t.created_at)}</td>
          </tr>))}</tbody></table>
      <ul className="cards mob-only">{txns.map((t) => (
        <li key={t.id}><button onClick={() => open(t)}><span className="ico" aria-hidden>{ICON[t.type] ?? '•'}</span>
          <span className="grow"><b>{describe(t)}</b><small className="muted">{t.type} · {dateTime(t.created_at)}</small></span>
          <span className="right"><b className={signedAmount(t) > 0 ? 'pos' : ''}>{money(signedAmount(t), t.currency, true)}</b><Status s={t.status} /></span></button></li>))}</ul>
    </>
  );
}
