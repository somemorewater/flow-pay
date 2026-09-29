import type { ReactNode } from 'react';
export default function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{error && <em role="alert">{error}</em>}</label>;
}
export function statusLabel(s: string): string {
  const map: Record<string, string> = {
    settled_won: 'Settled · Won',
    settled_lost: 'Settled · Lost',
    void: 'Void',
    processing: 'Processing',
    expired: 'Expired',
  };
  return map[s] ?? (s[0] ? s[0].toUpperCase() + s.slice(1) : s);
}
export function Status({ s }: { s: string }) { return <span className={`badge ${s}`}>{statusLabel(s)}</span>; }
