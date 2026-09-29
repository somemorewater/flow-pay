'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function Settings() {
  const { user, logout } = useAuth();
  const router = useRouter();
  return (
    <>
      <h1>Settings</h1>
      <div className="card stack">
        <h2>Account</h2>
        <div className="kv"><span>Email</span><b>{user?.email ?? '—'}</b></div>
        <button className="btn" onClick={() => { logout(); router.replace('/login'); }}>Log out</button>
      </div>
      <div className="card">
        <h2>API</h2>
        <p className="mono">{process.env.NEXT_PUBLIC_API_URL ?? 'Backend URL not configured'}</p>
        <p className="muted">Solana network: Devnet ({process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'})</p>
      </div>
    </>
  );
}
