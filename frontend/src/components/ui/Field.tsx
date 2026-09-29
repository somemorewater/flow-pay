import type { ReactNode } from 'react';
export default function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{error && <em role="alert">{error}</em>}</label>;
}
export function Status({ s }: { s: string }) { return <span className={`badge ${s}`}>{s[0].toUpperCase() + s.slice(1)}</span>; }
export const FAIL = "We couldn't process this payment. Please try again.";
