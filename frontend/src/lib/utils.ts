export function parseAmount(v: string): number | null { const n = Number(v.replace(/,/g, '')); return v.trim() !== '' && isFinite(n) && n > 0 ? n : null; }
