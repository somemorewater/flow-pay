const SYM: Record<string, string> = { USD: '$', NGN: '₦', EUR: '€', GBP: '£', SOL: '', USDC: '' };

function toNum(n: number | string): number {
  const v = typeof n === 'string' ? Number(n) : n;
  return isFinite(v) ? v : 0;
}

/** Backend sends decimal strings; accept both. Backend amounts are >= 0,
 *  so callers pass signed=true with an explicit negative for outflows. */
export function money(n: number | string, c: string, signed = false) {
  const v = toNum(n);
  const s = signed ? (v < 0 ? '-' : '+') : v < 0 ? '-' : '';
  const digits = c === 'NGN' ? 0 : c === 'SOL' ? 9 : 2;
  const str = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: Math.min(digits, 2), maximumFractionDigits: digits });
  const sym = SYM[c] ?? '';
  if (c === 'USDT' || c === 'USDC' || c === 'SOL') return `${s}${str} ${c}`;
  return `${s}${sym}${str}`;
}

export const dateTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
