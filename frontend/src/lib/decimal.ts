// Exact decimal math with BigInt — no floating point for financial values.
// Amounts are decimal strings; each is scaled to integer units of 10^decimals.

export function parseUnits(value: string, decimals: number): bigint {
  const t = value.trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) throw new Error(`Invalid decimal: ${value}`);
  const frac = (m[2] ?? '').padEnd(decimals, '0').slice(0, decimals);
  return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt(frac || '0');
}

/** Multiply two same-scale unit values, keeping the scale: (a * b) / 10^decimals. */
export function mulUnits(a: bigint, b: bigint, decimals: number): bigint {
  return (a * b) / 10n ** BigInt(decimals);
}

/** Format scaled integer units back to a decimal string with fixed places. */
export function formatUnits(units: bigint, decimals: number, places: number): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = String(abs % scale).padStart(decimals, '0').slice(0, places).padEnd(places, '0');
  return `${neg ? '-' : ''}${whole.toString()}${places > 0 ? `.${frac}` : ''}`;
}
