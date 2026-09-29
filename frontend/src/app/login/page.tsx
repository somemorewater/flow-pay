'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Field from '@/components/ui/Field';
import { useAuth } from '@/lib/auth';
import { userMessage } from '@/lib/api/client';

export default function Login() {
  const { user, loading, login, register } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (!loading && user) {
    router.replace('/');
    return <p className="muted pad">Already signed in. Redirecting…</p>;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes('@')) return setErr('Enter a valid email address.');
    if (password.length < 8) return setErr('Password must be at least 8 characters.');
    setErr('');
    setBusy(true);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(email.trim(), password);
      router.replace('/');
    } catch (e) {
      setErr(userMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <h1>{mode === 'login' ? 'Log in to FlowPay' : 'Create your FlowPay account'}</h1>
      <div className="card stack">
        <form className="stack" onSubmit={submit} noValidate>
          <Field label="Email" error={err}><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Password"><input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <button className="btn primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Register'}</button>
        </form>
        <button className="btn ghost" disabled={busy} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(''); }}>
          {mode === 'login' ? 'Need an account? Register' : 'Have an account? Log in'}
        </button>
      </div>
    </div>
  );
}
