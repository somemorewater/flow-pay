'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';

const NAV = [['/', 'Overview'], ['/wallet', 'Wallet'], ['/exchange', 'Exchange'], ['/bets', 'Bets'], ['/transactions', 'Transactions'], ['/payments', 'Payments']];

export default function Shell({ children }: { children: React.ReactNode }) {
  const p = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const cur = (h: string) => (h === '/' ? p === '/' || p === '/dashboard' : p.startsWith(h));
  const link = (h: string, l: string) => <Link key={h} href={h} className={cur(h) ? 'active' : ''} aria-current={cur(h) ? 'page' : undefined}>{l}</Link>;

  useEffect(() => {
    if (p !== '/login' && !loading && !user) router.replace('/login');
  }, [loading, user, router, p]);

  if (p === '/login') return <main className="content">{children}</main>;

  if (!loading && !user) {
    return <main className="content"><p className="muted pad">Redirecting to login…</p></main>;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">FlowPay</div>
        <nav aria-label="Main">{NAV.map(([h, l]) => link(h, l))}</nav>
        <div className="grow" />
        <nav aria-label="Secondary">{link('/settings', 'Settings')}</nav>
        <div className="me"><b>{user?.email ?? '…'}</b><small>FlowPay account</small></div>
        <button className="btn ghost" onClick={() => { logout(); router.replace('/login'); }}>Log out</button>
      </aside>
      <div className="main">
        <header className="topbar"><span className="brand mob-only">FlowPay</span><span className="desk-only">Dashboard</span><span className="grow" /><span><i className="dot" /> {user?.email ?? ''}</span></header>
        <main className="content">{children}</main>
      </div>
      <nav className="bottomnav" aria-label="Mobile">{NAV.map(([h, l]) => link(h, l))}</nav>
    </div>
  );
}
